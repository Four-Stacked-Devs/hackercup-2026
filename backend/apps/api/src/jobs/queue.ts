import PQueue from 'p-queue';
import { db } from '../db/client.js';
import { runIngestion, type PipelineLogger } from '../modules/ingestion/pipeline.js';
import { createEmbeddingWorker } from './embeddings.js';
import { createLessonWorker } from './lessons.js';
import { createPracticeWorker } from './practice.js';

/**
 * In-process background queue for the MVP.
 *
 * Concurrency 1: PDF parsing is the heaviest thing the 512MB instance does,
 * and the free model tiers are rate-limited, so running uploads in parallel
 * would make every one of them slower.
 *
 * The interface is deliberately narrow so this can be swapped for BullMQ
 * without touching the routes.
 */
export interface JobQueue {
  enqueueIngestion(materialId: string): void;
  /** Queue study notes for every topic of a READY material still on its draft. */
  enqueueLessons(materialId: string): void;
  /** A student opened this topic's draft: write its notes next. */
  prioritizeLesson(topicId: string): void;
  /** Fill a practice set created GENERATING. */
  enqueuePracticeSet(setId: string): void;
  /** Embed any passage without a vector from the current model. */
  enqueueEmbeddings(): void;
  /** Test/shutdown helper. */
  onIdle(): Promise<void>;
  readonly pending: number;
}

export function createJobQueue(logger: PipelineLogger): JobQueue {
  const queue = new PQueue({ concurrency: 1 });
  const lessons = createLessonWorker(logger);
  const practice = createPracticeWorker(logger);
  const embeddings = createEmbeddingWorker(logger);

  const enqueueLessons = (materialId: string) => {
    lessons.enqueueMaterial(materialId).catch((error) => {
      logger.error(`[queue] could not queue study notes: ${(error as Error).message}`);
    });
  };

  return {
    enqueueIngestion(materialId: string) {
      void queue.add(async () => {
        try {
          await runIngestion(materialId, logger, {
            onChunks: () => embeddings.kick(),
            onReady: enqueueLessons,
          });
        } catch (error) {
          // runIngestion already records failure on the material row; this is
          // the last-resort guard so one bad job cannot take down the worker.
          logger.error(`[queue] ingestion job crashed: ${(error as Error).message}`);
        }
      });
    },

    enqueueLessons,

    prioritizeLesson: (topicId) => lessons.prioritize(topicId),

    enqueuePracticeSet: (setId) => practice.enqueue(setId),

    enqueueEmbeddings: () => embeddings.kick(),

    onIdle: async () => {
      await queue.onIdle();
      await Promise.all([lessons.onIdle(), practice.onIdle(), embeddings.onIdle()]);
    },

    get pending() {
      return (
        queue.size + queue.pending + lessons.pending + practice.pending + embeddings.pending
      );
    },
  };
}

/**
 * Re-queue work a restart interrupted: uploads mid-ingestion, READY materials
 * with topics still waiting for their study notes, and practice sets whose
 * questions were still being written.
 *
 * The queue lives in process memory, so a restart mid-ingestion — every file
 * save under `tsx watch`, every deploy — dropped the job and left its material
 * PROCESSING forever, the progress bar frozen wherever it stopped. With one
 * API process, anything still PROCESSING at boot is exactly such an orphan, and
 * every stage clears its own output before writing, so running it again from
 * the top is safe. Swapping in BullMQ (or running several API processes) makes
 * this the broker's job instead.
 */
export async function resumeInterruptedIngestion(
  queue: JobQueue,
  logger: PipelineLogger,
): Promise<number> {
  const orphans = await db().material.findMany({
    where: { status: 'PROCESSING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  for (const { id } of orphans) queue.enqueueIngestion(id);

  const unfinished = await db().material.findMany({
    where: { status: 'READY', topics: { some: { lessonStatus: { in: ['DRAFT', 'WRITING'] } } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  for (const { id } of unfinished) queue.enqueueLessons(id);

  const sets = await db().practiceSet.findMany({
    where: { status: 'GENERATING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  for (const { id } of sets) queue.enqueuePracticeSet(id);

  // Passages a restart left without vectors, or embedded by a model this
  // deploy no longer uses. The job finds them itself.
  queue.enqueueEmbeddings();

  const resumed = orphans.length + unfinished.length + sets.length;
  if (resumed > 0) {
    logger.info(
      `[queue] resumed ${orphans.length} upload(s), study notes for ${unfinished.length} material(s) and ${sets.length} practice set(s) interrupted by a restart`,
    );
  }
  return resumed;
}
