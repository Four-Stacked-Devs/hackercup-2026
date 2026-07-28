import { createHash } from 'node:crypto';
import { env, VECTOR_DIMS } from '../env.js';

/**
 * Embeddings, zero cost by default.
 *
 * `local` runs bge-small-en-v1.5 in-process through onnxruntime. No API key, no
 * network at query time, no rate limits. The model (~130MB) is downloaded once
 * on first use and cached in EMBEDDING_CACHE_DIR.
 *
 * Groq — the configured LLM provider — serves no embeddings endpoint, which is
 * why this is a separate concern rather than another call on the LLM client.
 */

export interface Embedder {
  readonly modelId: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
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

      const pipe = await transformers.pipeline('feature-extraction', env.EMBEDDING_MODEL, {
        dtype: 'fp32',
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

const BATCH_SIZE = 16;

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
  const apiKey = env.OPENAI_API_KEY ?? env.LLM_API_KEY;
  return {
    modelId: env.EMBEDDING_MODEL,
    dims: VECTOR_DIMS,
    async embed(texts) {
      if (texts.length === 0) return [];
      const { createOpenAI } = await import('@ai-sdk/openai');
      const { embedMany } = await import('ai');

      const provider = createOpenAI({ apiKey: apiKey! });
      const { embeddings } = await embedMany({
        model: provider.textEmbeddingModel(env.EMBEDDING_MODEL),
        values: texts,
      });

      assertDims(embeddings);
      return embeddings;
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
      ? 'local (onnxruntime, no network)'
      : env.embeddingProvider === 'openai'
        ? 'openai'
        : 'none (deterministic stub)';

  return {
    purpose: 'Semantic retrieval over uploaded material',
    provider,
    model: getEmbedder().modelId,
  };
}
