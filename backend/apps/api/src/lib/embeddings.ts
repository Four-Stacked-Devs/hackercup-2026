import { createHash } from 'node:crypto';
import { env, VECTOR_DIMS } from '../env.js';
import { RateWindow } from './rate-window.js';

/**
 * Embeddings, zero cost by default.
 *
 * `local` runs bge-small-en-v1.5 in-process through onnxruntime. No API key, no
 * network at query time, no rate limits. The model is downloaded once on first
 * use and cached in EMBEDDING_CACHE_DIR — ~130MB at the default fp32, ~33MB at
 * EMBEDDING_DTYPE=q8. Each precision is a separate file, so switching dtype
 * downloads again.
 *
 * `google` calls Gemini's embedding model with the same free key as the LLM.
 * It is what the 512MB deploy uses: the local model plus onnxruntime peaked at
 * ~450MB while a PDF was being prepared, and the instance was killed mid-upload.
 *
 * Every vector is stored with the model that wrote it (`Chunk.embeddingModel`),
 * because two models' vectors are not comparable: a question embedded by one
 * model finds nonsense among passages embedded by another.
 */

/**
 * Retrieval models embed a question and a passage differently. A `query` is a
 * student waiting on an answer, so it is also paced ahead of bulk `document`
 * work.
 */
export type EmbedPurpose = 'document' | 'query';

export interface Embedder {
  readonly modelId: string;
  readonly dims: number;
  embed(texts: string[], purpose?: EmbedPurpose): Promise<number[][]>;
}

// The transformers pipeline is expensive to construct, so it is built once.
type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = env.EMBEDDING_CACHE_DIR;
      // Local ONNX only — never call out to a hosted inference API.
      transformers.env.allowRemoteModels = true;

      // Precision is a deploy-time trade, not a code constant: fp32 locally,
      // q8 on a 512MB container. See EMBEDDING_DTYPE in env.ts.
      const pipe = await transformers.pipeline('feature-extraction', env.EMBEDDING_MODEL, {
        dtype: env.EMBEDDING_DTYPE,
        // Memory, not speed, is the constraint that matters: the free instance
        // is 512MB and 0.1 CPU. By default onnxruntime starts a thread per core,
        // each with its own memory arena, and keeps every arena at its peak for
        // the life of the process — measured at ~720MB for one 58-passage
        // material, which killed the instance mid-upload. One thread and no
        // arena give memory back after each batch; on 0.1 CPU the extra threads
        // were not making it faster anyway.
        session_options: {
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
          enableCpuMemArena: false,
          enableMemPattern: false,
        },
      });

      return pipe as unknown as FeatureExtractor;
    })();
  }
  return extractorPromise;
}

/**
 * Deterministic hashed bag-of-words vectors.
 *
 * Used when EMBEDDING_PROVIDER=stub. Retrieval quality is much weaker than a
 * real model — this exists so the pipeline runs with no downloads at all (CI,
 * offline demos), not because it is good.
 */
export function hashEmbed(text: string, dims = VECTOR_DIMS): number[] {
  const vector = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % dims;
    const sign = (digest[4]! & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.hypot(...vector);
  if (magnitude === 0) return vector;
  return vector.map((v) => v / magnitude);
}

/**
 * Passages embedded per model call. Attention memory grows with batch size ×
 * sequence length², and passages here run to the model's 512-token limit, so a
 * batch of 16 held hundreds of MB at once. See EMBEDDING_BATCH_SIZE in env.ts.
 */
const BATCH_SIZE = env.EMBEDDING_BATCH_SIZE;

function createLocalEmbedder(): Embedder {
  return {
    modelId: env.EMBEDDING_MODEL,
    dims: VECTOR_DIMS,
    async embed(texts) {
      if (texts.length === 0) return [];
      const extractor = await getExtractor();
      const out: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const result = await extractor(batch, { pooling: 'mean', normalize: true });
        out.push(...result.tolist());
      }

      assertDims(out);
      return out;
    },
  };
}

function createOpenAiEmbedder(): Embedder {
  return {
    modelId: env.EMBEDDING_MODEL,
    dims: VECTOR_DIMS,
    async embed(texts) {
      if (texts.length === 0) return [];
      const { createOpenAI } = await import('@ai-sdk/openai');
      const { embedMany } = await import('ai');

      const provider = createOpenAI({ apiKey: env.embeddingApiKey! });
      const { embeddings } = await embedMany({
        model: provider.textEmbeddingModel(env.EMBEDDING_MODEL),
        values: texts,
        // text-embedding-3 models are 1536+ wide natively.
        providerOptions: { openai: { dimensions: VECTOR_DIMS } },
      });

      assertDims(embeddings);
      return embeddings;
    },
  };
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

/** Gemini's batch endpoint takes at most 100 texts. */
const GOOGLE_MAX_ITEMS = 100;
/**
 * Tokens per call. Small calls spread a material's passages across the minute
 * instead of spending the whole quota at once, which leaves room for a
 * student's question in between.
 */
const GOOGLE_MAX_CALL_TOKENS = 8_000;
/** Bulk work fills at most this share of the minute; a question gets the rest. */
const DOCUMENT_SHARE = 0.8;
const CALL_TIMEOUT_MS = 30_000;
/** Minute limits clear in a minute; this many refusals in a row means the day's quota. */
const MAX_QUOTA_RETRIES = 2;
const QUOTA_PAUSE_MS = 10 * 60_000;

const estimateTokens = (text: string) => Math.ceil(text.length / 4) + 8;

/** Consecutive runs of texts, each within the provider's per-call limits. */
export function splitForEmbedding(
  texts: string[],
  limits: { maxItems: number; maxTokens: number } = {
    maxItems: GOOGLE_MAX_ITEMS,
    maxTokens: GOOGLE_MAX_CALL_TOKENS,
  },
): { texts: string[]; tokens: number }[] {
  const calls: { texts: string[]; tokens: number }[] = [];
  let current: { texts: string[]; tokens: number } = { texts: [], tokens: 0 };

  for (const text of texts) {
    const tokens = estimateTokens(text);
    const full =
      current.texts.length >= limits.maxItems || current.tokens + tokens > limits.maxTokens;
    if (current.texts.length > 0 && full) {
      calls.push(current);
      current = { texts: [], tokens: 0 };
    }
    current.texts.push(text);
    current.tokens += tokens;
  }

  if (current.texts.length > 0) calls.push(current);
  return calls;
}

/**
 * Unit length. Gemini only normalises its full 3072-wide output; a truncated
 * vector comes back at whatever length its first 384 values have.
 */
export function normalise(vector: number[]): number[] {
  const magnitude = Math.hypot(...vector);
  return magnitude === 0 ? vector : vector.map((v) => v / magnitude);
}

function isQuotaError(error: unknown): boolean {
  const e = error as { statusCode?: number; lastError?: { statusCode?: number } };
  return e.statusCode === 429 || e.lastError?.statusCode === 429;
}

/** Thrown while a spent quota is paused, so callers fall back at once. */
export class EmbeddingQuotaError extends Error {
  constructor(readonly retryInMs: number) {
    super(`embedding quota is spent; next try in ${Math.ceil(retryInMs / 1000)}s`);
  }
}

let embeddingsPausedUntil = 0;

/** Milliseconds until the hosted embedder may be called again after a spent quota, or 0. */
export function embeddingsPausedFor(): number {
  return Math.max(0, embeddingsPausedUntil - Date.now());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createGoogleEmbedder(): Embedder {
  const window = new RateWindow(env.embeddingLimits);

  return {
    modelId: env.EMBEDDING_MODEL,
    dims: VECTOR_DIMS,
    async embed(texts, purpose = 'document') {
      if (texts.length === 0) return [];
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const { embedMany } = await import('ai');

      const model = createGoogleGenerativeAI({ apiKey: env.embeddingApiKey! }).textEmbeddingModel(
        env.EMBEDDING_MODEL,
      );
      const out: number[][] = [];

      for (const call of splitForEmbedding(texts)) {
        for (let attempt = 0; ; attempt += 1) {
          const paused = embeddingsPausedFor();
          if (paused > 0) throw new EmbeddingQuotaError(paused);

          await window.reserve(call.tokens, purpose === 'query' ? 1 : DOCUMENT_SHARE);

          try {
            const { embeddings } = await embedMany({
              model,
              values: call.texts,
              // Our own retries below know the quota; the SDK's would not wait long enough.
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
              providerOptions: {
                google: {
                  outputDimensionality: VECTOR_DIMS,
                  taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
                },
              },
            });
            out.push(...embeddings.map(normalise));
            break;
          } catch (error) {
            if (!isQuotaError(error)) throw error;
            // A question will not wait a minute; retrieval falls back instead.
            if (purpose === 'query') throw error;
            if (attempt >= MAX_QUOTA_RETRIES) {
              // Gemini words a minute limit and a day's limit the same way.
              // Refused after the minute has cleared twice, it is the day's.
              embeddingsPausedUntil = Date.now() + QUOTA_PAUSE_MS;
              throw new EmbeddingQuotaError(QUOTA_PAUSE_MS);
            }
            await sleep(60_000);
          }
        }
      }

      assertDims(out);
      return out;
    },
  };
}

function createStubEmbedder(): Embedder {
  return {
    modelId: 'stub-hashed-bow',
    dims: VECTOR_DIMS,
    async embed(texts) {
      return texts.map((t) => hashEmbed(t));
    },
  };
}

function assertDims(vectors: number[][]): void {
  const wrong = vectors.find((v) => v.length !== VECTOR_DIMS);
  if (wrong) {
    throw new Error(
      `Embedding model returned ${wrong.length} dimensions but the pgvector column is vector(${VECTOR_DIMS}). ` +
        `Changing the model requires a migration.`,
    );
  }
}

let cached: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (cached) return cached;

  cached =
    env.embeddingProvider === 'local'
      ? createLocalEmbedder()
      : env.embeddingProvider === 'google'
        ? createGoogleEmbedder()
        : env.embeddingProvider === 'openai'
          ? createOpenAiEmbedder()
          : createStubEmbedder();

  return cached;
}

/** Postgres vector literal: pgvector accepts the JSON array form. */
export function toVectorLiteral(vector: number[]): string {
  return JSON.stringify(vector);
}

export function describeEmbeddings(): { purpose: string; provider: string; model: string } {
  const provider =
    env.embeddingProvider === 'local'
      ? `local (onnxruntime, no network, ${env.EMBEDDING_DTYPE})`
      : env.embeddingProvider === 'stub'
        ? 'none (deterministic stub)'
        : env.embeddingProvider;

  return {
    purpose: 'Semantic retrieval over uploaded material',
    provider,
    model: getEmbedder().modelId,
  };
}
