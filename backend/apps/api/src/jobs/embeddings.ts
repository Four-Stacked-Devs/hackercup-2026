import { db } from '../db/client.js';
import { env } from '../env.js';
import {
  embeddingsPausedFor,
  EmbeddingQuotaError,
  getEmbedder,
  toVectorLiteral,
} from '../lib/embeddings.js';
import type { PipelineLogger } from '../modules/ingestion/pipeline.js';

/**
 * Embeds passages in the background, newest upload first.
 *
 * Not part of ingestion: a hosted embedder's free tier covers about one 60-page
 * PDF a minute, and a student should not wait on that before they can open the
 * topics. Until a material's passages are all embedded, retrieval uses keyword
 * search for it (see `retrieval.ts`), so nothing is blocked on this job.
 *
 * The same job repairs everything else a vector can be missing for: a batch
 * that failed during a spent quota, a restart part way through, or passages
 * embedded by a different model before EMBEDDING_PROVIDER was changed. It keeps
 * going until no passage needs a vector, and restarts itself after a paused
 * quota resets.
 */

export interface EmbeddingWorker {
  /** Check for passages without a current vector. Cheap to call often. */
  kick(): void;
  onIdle(): Promise<void>;
  readonly pending: number;
}

export interface PendingChunk {
  id: string;
  content: string;
}

export interface EmbeddingWorkerDeps {
  nextBatch: () => Promise<PendingChunk[]>;
  embed: (texts: string[]) => Promise<number[][]>;
  save: (rows: { id: string; vector: number[] }[]) => Promise<void>;
  /** Milliseconds until a spent quota resets, or 0. */
  pausedFor: () => number;
  /** Consecutive failed batches before the job stops until its next kick. */
  maxFailures: number;
}

/** Passages per round trip: a few of Gemini's calls' worth, one UPDATE. */
const BATCH_SIZE = 32;

/**
 * One UPDATE per batch of chunks, not one per chunk.
 *
 * Each statement is a network round trip (~240 ms to the hosted database from
 * here), so a 100-chunk module spent ~24 s just writing vectors one at a time.
 */
export function buildEmbeddingUpdate(
  batch: { id: string; vector: number[] }[],
  model: string,
): { sql: string; params: string[] } {
  const values = batch.map((_, i) => `($${i * 2 + 2}::text, $${i * 2 + 3}::text)`).join(', ');
  return {
    sql: `UPDATE "Chunk" AS c SET embedding = v.embedding::vector, "embeddingModel" = $1 FROM (VALUES ${values}) AS v(id, embedding) WHERE c.id = v.id`,
    params: [model, ...batch.flatMap((row) => [row.id, toVectorLiteral(row.vector)])],
  };
}

/**
 * Passages still to embed, newest material first. The stub never replaces a
 * real model's vector: its own are only a placeholder.
 */
async function loadNextBatch(): Promise<PendingChunk[]> {
  const model = getEmbedder().modelId;
  const stale =
    env.embeddingProvider === 'stub'
      ? `c.embedding IS NULL`
      : `(c.embedding IS NULL OR c."embeddingModel" IS DISTINCT FROM $1)`;

  return db().$queryRawUnsafe<PendingChunk[]>(
    `SELECT c.id, c.content
       FROM "Chunk" c JOIN "Material" m ON m.id = c."materialId"
      WHERE ${stale} AND m.status <> 'FAILED'
      ORDER BY m."createdAt" DESC, c."orderIndex" ASC
      LIMIT ${BATCH_SIZE}`,
    ...(env.embeddingProvider === 'stub' ? [] : [model]),
  );
}

async function saveVectors(rows: { id: string; vector: number[] }[]): Promise<void> {
  // Prisma cannot write an Unsupported() column; raw SQL is required.
  const { sql, params } = buildEmbeddingUpdate(rows, getEmbedder().modelId);
  await db().$executeRawUnsafe(sql, ...params);
}

export function createEmbeddingWorker(
  logger: PipelineLogger,
  overrides: Partial<EmbeddingWorkerDeps> = {},
): EmbeddingWorker {
  const deps: EmbeddingWorkerDeps = {
    nextBatch: loadNextBatch,
    embed: (texts) => getEmbedder().embed(texts, 'document'),
    save: saveVectors,
    pausedFor: embeddingsPausedFor,
    maxFailures: 3,
    ...overrides,
  };

  let running: Promise<void> | null = null;
  let kickedWhileRunning = false;
  let resumeTimer: NodeJS.Timeout | null = null;

  /** Try again once a paused quota resets. Returns false when it is not paused. */
  const resumeAfterPause = (): boolean => {
    const wait = deps.pausedFor();
    if (wait <= 0) return false;
    if (!resumeTimer) {
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        kick();
      }, wait + 1_000);
      resumeTimer.unref();
    }
    return true;
  };

  async function drain(): Promise<void> {
    let failures = 0;
    let embedded = 0;

    while (failures < deps.maxFailures) {
      if (resumeAfterPause()) break;

      const batch = await deps.nextBatch();
      if (batch.length === 0) break;

      try {
        const vectors = await deps.embed(batch.map((chunk) => chunk.content));
        const rows = batch.flatMap((chunk, index) =>
          vectors[index] ? [{ id: chunk.id, vector: vectors[index] }] : [],
        );
        if (rows.length === 0) throw new Error('the embedder returned no vectors');
        await deps.save(rows);
        embedded += rows.length;
        failures = 0;
      } catch (error) {
        if (error instanceof EmbeddingQuotaError) {
          logger.warn(`[embed] ${error.message}; keyword search covers the rest until then`);
          continue; // The top of the loop schedules the retry.
        }
        failures += 1;
        logger.warn(`[embed] batch failed: ${(error as Error).message}`);
      }
    }

    if (failures >= deps.maxFailures) {
      logger.warn(`[embed] stopped after ${failures} failed batches; the next upload or restart retries`);
    }
    if (embedded > 0) logger.info(`[embed] embedded ${embedded} passage(s)`);
  }

  function kick(): void {
    if (running) {
      kickedWhileRunning = true;
      return;
    }

    // Deferred a tick, so a kick from inside the first step still sees `running`.
    running = Promise.resolve()
      .then(drain)
      .catch((error) => {
        logger.error(`[embed] job crashed: ${(error as Error).message}`);
      })
      .finally(() => {
        running = null;
        // Passages stored after the last empty check are picked up now.
        if (kickedWhileRunning) {
          kickedWhileRunning = false;
          kick();
        }
      });
  }

  return {
    kick,

    async onIdle() {
      while (running) await running;
    },

    get pending() {
      return running ? 1 : 0;
    },
  };
}
