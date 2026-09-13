import PQueue from 'p-queue';
import { db } from '../db/client.js';
import { env } from '../env.js';
import type { PipelineLogger } from '../modules/ingestion/pipeline.js';
import { fillPracticeSet, type FillOutcome } from '../services/practice.js';

/**
 * Fills practice sets created GENERATING, in the background.
 *
 * Foreground work — a student is watching the progress card — so it uses the
 * normal LLM client, which background lesson and question-bank jobs yield to.
 * In process, like the other queues; sets still GENERATING after a restart are
 * picked up again by `resumeInterruptedIngestion`.
 */

export interface PracticeWorker {
  enqueue(setId: string): void;
  onIdle(): Promise<void>;
  readonly pending: number;
}

export interface PracticeWorkerDeps {
  fill: (setId: string, logger: PipelineLogger) => Promise<FillOutcome>;
  /** A crashed job must not leave the student's screen polling forever. */
  markFailed: (setId: string) => Promise<unknown>;
  concurrency: number;
}

export function createPracticeWorker(
  logger: PipelineLogger,
  overrides: Partial<PracticeWorkerDeps> = {},
): PracticeWorker {
  const deps: PracticeWorkerDeps = {
    fill: fillPracticeSet,
    markFailed: (setId) =>
      db().practiceSet.updateMany({
        where: { id: setId, status: 'GENERATING' },
        data: { status: 'FAILED' },
      }),
    concurrency: env.llmConcurrency,
    ...overrides,
  };

  const queue = new PQueue({ concurrency: deps.concurrency });
  const queued = new Set<string>();

  return {
    enqueue(setId) {
      if (queued.has(setId)) return;
      queued.add(setId);

      void queue.add(async () => {
        try {
          const outcome = await deps.fill(setId, logger);
          if (outcome !== 'skipped') logger.info(`[practice] set ${setId} ${outcome}`);
        } catch (error) {
          logger.warn(`[practice] set ${setId} crashed: ${(error as Error).message}`);
          await deps.markFailed(setId).catch(() => {});
        } finally {
          queued.delete(setId);
        }
      });
    },

    onIdle: () => queue.onIdle(),

    get pending() {
      return queue.size + queue.pending;
    },
  };
}
