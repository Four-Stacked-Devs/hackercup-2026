import PQueue from 'p-queue';
import { runIngestion, type PipelineLogger } from '../modules/ingestion/pipeline.js';

/**
 * In-process background queue for the MVP.
 *
 * Concurrency 1: ingestion is CPU-heavy (PDF parsing plus local ONNX
 * embeddings) and the free Groq tier is rate-limited, so running uploads in
 * parallel would make every one of them slower.
 *
 * The interface is deliberately narrow so this can be swapped for BullMQ
 * without touching the routes.
 */
export interface JobQueue {
  enqueueIngestion(materialId: string): void;
  /** Test/shutdown helper. */
  onIdle(): Promise<void>;
  readonly pending: number;
}

export function createJobQueue(logger: PipelineLogger): JobQueue {
  const queue = new PQueue({ concurrency: 1 });

  return {
    enqueueIngestion(materialId: string) {
      void queue.add(async () => {
        try {
          await runIngestion(materialId, logger);
        } catch (error) {
          // runIngestion already records failure on the material row; this is
          // the last-resort guard so one bad job cannot take down the worker.
          logger.error(`[queue] ingestion job crashed: ${(error as Error).message}`);
        }
      });
    },

    onIdle: () => queue.onIdle(),

    get pending() {
      return queue.size + queue.pending;
    },
  };
}
