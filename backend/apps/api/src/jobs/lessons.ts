import PQueue from 'p-queue';
import { db } from '../db/client.js';
import { env } from '../env.js';
import { createLlmClient, providerPausedFor, type LlmClient } from '../lib/llm.js';
import {
  writeStudyNotes as writeStudyNotesDefault,
  type StudyNotesOutcome,
} from '../modules/ingestion/lesson-writer.js';
import type { PipelineLogger } from '../modules/ingestion/pipeline.js';
import { ensurePlan } from '../services/plan.js';
import { stockQuestionBank } from '../services/practice.js';

/**
 * The background work that follows a material turning READY, in this order:
 *   1. the owner's learning plan,
 *   2. AI study notes replacing each topic's draft, in course order,
 *   3. a stocked question bank per topic, so practice sets open without a
 *      model call.
 *
 * Opening a topic moves its study notes to the front: the lesson on screen is
 * the one worth waiting for. The order lives in `waiting` rather than in the
 * queue's own priorities, because a job's work is chosen when it starts, not
 * when it is queued; moving one forward is then a list operation.
 *
 * Every model call here is background priority, so chat and practice sets go
 * first. In process, like the ingestion queue. Materials with topics still
 * DRAFT or WRITING after a restart are picked up again by
 * `resumeInterruptedIngestion`, bank jobs included.
 */

export interface LessonWorker {
  /** Prebuild the owner's plan, then queue study notes and question banks. */
  enqueueMaterial(materialId: string): Promise<void>;
  /** Write this topic next. Queues it if it is not already waiting. */
  prioritize(topicId: string): void;
  onIdle(): Promise<void>;
  readonly pending: number;
}

export interface LessonWorkerDeps {
  writeStudyNotes: (
    topicId: string,
    llm: LlmClient,
    logger: PipelineLogger,
  ) => Promise<StudyNotesOutcome>;
  loadWork: (
    materialId: string,
  ) => Promise<{ userId: string; topicIds: string[]; bankTopicIds: string[] } | null>;
  stockBank: (
    topicId: string,
    llm: LlmClient,
    logger: PipelineLogger,
  ) => Promise<'stocked' | 'skipped' | 'failed' | 'deferred'>;
  prebuildPlan: (userId: string, materialId: string) => Promise<unknown>;
  /** Milliseconds until the provider's spent quota resets, or 0. */
  pausedFor: () => number;
  concurrency: number;
}

/** A job deferred with no reset time named is tried again after this long. */
const MIN_DEFER_MS = 30_000;

async function loadWorkDefault(materialId: string) {
  const material = await db().material.findUnique({
    where: { id: materialId },
    select: { userId: true, status: true },
  });
  if (!material || material.status !== 'READY') return null;

  const topics = await db().topic.findMany({
    where: { materialId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, lessonStatus: true },
  });

  return {
    userId: material.userId,
    topicIds: topics
      .filter((t) => t.lessonStatus === 'DRAFT' || t.lessonStatus === 'WRITING')
      .map((t) => t.id),
    // Every topic: a bank job checks the stock when it runs and skips a full one.
    bankTopicIds: topics.map((t) => t.id),
  };
}

export function createLessonWorker(
  logger: PipelineLogger,
  overrides: Partial<LessonWorkerDeps> = {},
): LessonWorker {
  const deps: LessonWorkerDeps = {
    writeStudyNotes: writeStudyNotesDefault,
    stockBank: stockQuestionBank,
    pausedFor: providerPausedFor,
    loadWork: loadWorkDefault,
    prebuildPlan: (userId, materialId) => ensurePlan(userId, materialId, { background: true }),
    concurrency: env.llmConcurrency,
    ...overrides,
  };

  const queue = new PQueue({ concurrency: deps.concurrency });
  // Background: yields to chat and ingestion and leaves them quota headroom.
  const llm = createLlmClient(logger, { background: true });

  /** Job keys (`lesson:<topicId>`, `bank:<topicId>`) waiting for a slot, next first. */
  const waiting: string[] = [];
  const running = new Set<string>();

  /** Jobs parked until the provider's quota resets, each with one timer. */
  const deferred = new Set<string>();
  let announcedUntil = 0;

  /**
   * Out of quota is temporary, and anything written from the fallback now would
   * be kept — so the job waits for the reset instead. The draft lesson stays
   * readable meanwhile, and practice sets still work from the fallback.
   */
  const defer = (key: string) => {
    if (deferred.has(key)) return;
    deferred.add(key);

    const wait = Math.max(deps.pausedFor(), MIN_DEFER_MS);
    const resumeAt = Date.now() + wait;
    if (resumeAt > announcedUntil + MIN_DEFER_MS) {
      announcedUntil = resumeAt;
      logger.info(
        `[background] provider is out of quota; pausing study notes and question banks until ${new Date(resumeAt).toISOString()}`,
      );
    }

    setTimeout(() => {
      deferred.delete(key);
      schedule(key, false);
    }, wait + 1_000).unref?.();
  };

  const run = async (key: string) => {
    if (deps.pausedFor() > 0) return defer(key);

    const [kind, topicId] = key.split(':') as ['lesson' | 'bank', string];
    const outcome =
      kind === 'lesson'
        ? await deps.writeStudyNotes(topicId, llm, logger)
        : await deps.stockBank(topicId, llm, logger);

    if (outcome === 'deferred') return defer(key);
    if (outcome !== 'skipped') {
      logger.info(
        kind === 'lesson'
          ? `[lessons] topic ${topicId} ${outcome}`
          : `[questions] bank for topic ${topicId} ${outcome}`,
      );
    }
  };

  const runNext = async () => {
    const key = waiting.shift();
    if (!key) return;

    running.add(key);
    try {
      await run(key);
    } catch (error) {
      // The topic or its material was deleted mid-write, or the database blipped.
      // Whatever was there before is still there; nothing to undo.
      logger.warn(`[background] ${key} failed: ${(error as Error).message}`);
    } finally {
      running.delete(key);
    }
  };

  const schedule = (key: string, first: boolean) => {
    if (running.has(key)) return;

    const at = waiting.indexOf(key);
    if (at !== -1) {
      if (first && at > 0) {
        waiting.splice(at, 1);
        waiting.unshift(key);
      }
      return;
    }

    if (first) waiting.unshift(key);
    else waiting.push(key);
    void queue.add(runNext);
  };

  return {
    async enqueueMaterial(materialId) {
      const work = await deps.loadWork(materialId);
      if (!work) return;

      // Planned before any lesson: one call, and the plan is the first thing a
      // student opens after upload. Building it here means that open is instant.
      void queue.add(async () => {
        try {
          await deps.prebuildPlan(work.userId, materialId);
        } catch (error) {
          logger.warn(`[lessons] plan prebuild failed: ${(error as Error).message}`);
        }
      });

      for (const topicId of work.topicIds) schedule(`lesson:${topicId}`, false);
      for (const topicId of work.bankTopicIds) schedule(`bank:${topicId}`, false);
      if (work.topicIds.length > 0) {
        logger.info(`[lessons] writing study notes for ${work.topicIds.length} topic(s)`);
      }
    },

    prioritize(topicId) {
      schedule(`lesson:${topicId}`, true);
    },

    onIdle: () => queue.onIdle(),

    get pending() {
      return waiting.length + running.size;
    },
  };
}
