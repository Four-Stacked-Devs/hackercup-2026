import { z } from 'zod';
import { loadEnvFiles } from './lib/load-env.js';

// Must run before process.env is read below. Not `import 'dotenv/config'`:
// that only looks in the current working directory, which misses a .env at the
// monorepo root when the API is launched from apps/api.
const loadedEnvFiles = loadEnvFiles();

/**
 * A key left blank in .env (`DATABASE_URL=`) arrives as an empty string, not as
 * undefined. Treat blank as "not configured" so the zero-config path still
 * works when someone copies .env.example and fills in only part of it.
 */
const optionalSetting = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const rawEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Database — both optional. Absent or blank means "run on PGlite".
  DATABASE_URL: optionalSetting,
  DIRECT_URL: optionalSetting,
  PGLITE_DIR: z.string().default('./.pglite'),

  // LLM
  LLM_PROVIDER: z.enum(['google', 'groq', 'openai', 'anthropic', 'stub']).default('google'),
  LLM_API_KEY: optionalSetting,
  /** Blank means the provider's default in DEFAULT_LLM_MODEL. */
  LLM_MODEL: optionalSetting,
  /** Per-minute pacing. Blank means the provider's free-tier default in DEFAULT_LLM_LIMITS. */
  LLM_MAX_RPM: optionalSetting.transform((v) => (v ? Number(v) : undefined)).pipe(
    z.number().int().positive().optional(),
  ),
  LLM_MAX_TPM: optionalSetting.transform((v) => (v ? Number(v) : undefined)).pipe(
    z.number().int().positive().optional(),
  ),
  /** Background study-note calls in flight at once. Blank means DEFAULT_LLM_CONCURRENCY. */
  LLM_CONCURRENCY: optionalSetting.transform((v) => (v ? Number(v) : undefined)).pipe(
    z.number().int().positive().optional(),
  ),

  // Embeddings
  EMBEDDING_PROVIDER: z.enum(['local', 'openai', 'stub']).default('local'),
  EMBEDDING_MODEL: z.string().default('Xenova/bge-small-en-v1.5'),
  EMBEDDING_DIMS: z.coerce.number().int().positive().default(384),
  EMBEDDING_CACHE_DIR: z.string().default('./.models'),
  /**
   * ONNX weight precision for the local embedder.
   *
   * `fp32` is the default because it is the reference quality the retrieval
   * numbers in README "Verification" were measured against. `q8` quantises the
   * weights to int8 — roughly a quarter of the memory (~33MB instead of
   * ~130MB), which is what makes the model fit alongside Node, Fastify and
   * Prisma inside a 512MB free-tier container. Retrieval quality drops
   * slightly; it is a deploy-time trade, not the local default.
   */
  EMBEDDING_DTYPE: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4']).default('fp32'),
  OPENAI_API_KEY: optionalSetting,

  // Uploads
  STORAGE_DIR: z.string().default('./.uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20_971_520),
});

const parsed = rawEnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

/**
 * The dimension baked into the pgvector column by the initial migration.
 * A pgvector column's dimension cannot be changed without a migration, so
 * EMBEDDING_DIMS is a consistency check, not a runtime knob.
 */
export const VECTOR_DIMS = 384;

/** Which database backend to use. */
export type DbMode = 'postgres' | 'pglite';

export type LlmProvider = 'google' | 'groq' | 'openai' | 'anthropic' | 'stub';

/** Falling back to the stub keeps the API usable with no credentials at all. */
const llmProvider: LlmProvider =
  raw.LLM_PROVIDER === 'stub' || !raw.LLM_API_KEY ? 'stub' : raw.LLM_PROVIDER;

/**
 * Gemini Flash is the default because its free tier (no card) allows ~250K
 * tokens a minute — enough to ingest a whole module in one pass. Groq's free
 * tier caps its strong models at ~8K a minute, which one lesson call can fill.
 */
const DEFAULT_LLM_MODEL: Record<LlmProvider, string> = {
  google: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5',
  stub: 'stub-deterministic',
};

/** Free-tier ceilings, kept just under the published numbers. Paid keys can raise them. */
const DEFAULT_LLM_LIMITS: Record<LlmProvider, { rpm?: number; tpm?: number }> = {
  google: { rpm: 10, tpm: 240_000 },
  groq: { rpm: 28, tpm: 7_500 },
  openai: {},
  anthropic: {},
  stub: {},
};

/**
 * How many topics' study notes are written at once. Groq's free tier is bound by
 * tokens a minute — one lesson call nearly fills it — so parallel calls there
 * would only queue inside the pacer. Gemini's quota is wide enough for four.
 */
const DEFAULT_LLM_CONCURRENCY: Record<LlmProvider, number> = {
  google: 4,
  groq: 1,
  openai: 4,
  anthropic: 4,
  stub: 4,
};

const llmModel = raw.LLM_MODEL ?? DEFAULT_LLM_MODEL[llmProvider];

const llmLimits = {
  rpm: raw.LLM_MAX_RPM ?? DEFAULT_LLM_LIMITS[llmProvider].rpm,
  tpm: raw.LLM_MAX_TPM ?? DEFAULT_LLM_LIMITS[llmProvider].tpm,
};

const embeddingProvider: 'local' | 'openai' | 'stub' =
  raw.EMBEDDING_PROVIDER === 'openai' && !(raw.OPENAI_API_KEY ?? raw.LLM_API_KEY)
    ? 'stub'
    : raw.EMBEDDING_PROVIDER;

const dbMode: DbMode = raw.DATABASE_URL ? 'postgres' : 'pglite';

export const env = {
  ...raw,
  LLM_MODEL: llmModel,
  dbMode,
  llmProvider,
  llmLimits,
  llmConcurrency: raw.LLM_CONCURRENCY ?? DEFAULT_LLM_CONCURRENCY[llmProvider],
  embeddingProvider,
  /** True when nothing external is configured — used for the boot banner. */
  isFullyOffline: dbMode === 'pglite' && llmProvider === 'stub',
} as const;

export type Env = typeof env;

if (raw.EMBEDDING_DIMS !== VECTOR_DIMS) {
  console.warn(
    `[env] EMBEDDING_DIMS=${raw.EMBEDDING_DIMS} but the pgvector column is vector(${VECTOR_DIMS}). ` +
      `Ignoring the env value. Changing dimensions requires a new migration.`,
  );
}

/** Which .env files were actually loaded — surfaced at boot to avoid guesswork. */
export const envFilesLoaded = loadedEnvFiles;

/** Human-readable summary printed once at boot so the mode is never a mystery. */
export function describeMode(): string {
  const db =
    env.dbMode === 'postgres'
      ? 'Postgres (DATABASE_URL)'
      : `PGlite (embedded, ${env.PGLITE_DIR})`;
  const llm =
    env.llmProvider === 'stub'
      ? 'stub (deterministic, no API key set)'
      : `${env.llmProvider}:${env.LLM_MODEL}`;
  const emb =
    env.embeddingProvider === 'stub'
      ? 'stub (deterministic hashed vectors)'
      : env.embeddingProvider === 'local'
        ? `local ${env.EMBEDDING_MODEL} (${VECTOR_DIMS}d, ${env.EMBEDDING_DTYPE})`
        : `openai ${env.EMBEDDING_MODEL}`;
  return `db=${db}  llm=${llm}  embeddings=${emb}`;
}
