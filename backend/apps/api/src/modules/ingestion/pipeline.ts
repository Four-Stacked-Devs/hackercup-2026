import { randomUUID } from 'node:crypto';
import type { IngestionStage, LessonStatus } from '../../generated/prisma/enums.js';
import { db } from '../../db/client.js';
import { getEmbedder, toVectorLiteral } from '../../lib/embeddings.js';
import { ApiException } from '../../lib/errors.js';
import { createLlmClient, type LlmLogger } from '../../lib/llm.js';
import { extractPdf } from '../../lib/pdf.js';
import { getFile } from '../../lib/storage.js';
import { chunkPages } from './chunk.js';
import { writeDraftLessons } from './lesson-writer.js';
import { extractCourseMap, slugify, type TopicDraft } from './topics.js';
import { GENERIC_VOCABULARY } from './vocabulary.js';

/**
 * The ingestion pipeline — the part of an upload the student waits for.
 *
 *   extract → chunk → (course map ‖ embeddings) → draft lessons → READY
 *
 * It stops at READY on purpose. The AI study notes are one model call per
 * topic — minutes for a long module on a free tier — and nothing but the lesson
 * itself needs them, so they are written afterwards by the lesson worker
 * (jobs/lessons.ts), replacing each topic's draft in place. Chat, practice and
 * the plan work from the moment this returns.
 *
 * Every stage writes `stage`/`stagePercent` so the client's poll has something
 * honest to show, and every stage clears its own output first, so a re-run
 * (a retry, or a restart that interrupted it) never duplicates.
 */

export interface PipelineLogger extends LlmLogger {
  error: (msg: string) => void;
}

export interface IngestionHooks {
  /** Fired once the material is READY, to start writing study notes. */
  onReady?: (materialId: string) => void;
}

const STAGE_PERCENT: Record<IngestionStage, number> = {
  EXTRACTING: 10,
  CHUNKING: 25,
  EXTRACTING_TOPICS: 40,
  EMBEDDING: 70,
  BUILDING_LESSONS: 90,
  DONE: 100,
};

async function setStage(
  materialId: string,
  stage: IngestionStage,
  extra: { pageCount?: number } = {},
): Promise<void> {
  await db().material.update({
    where: { id: materialId },
    data: { stage, stagePercent: STAGE_PERCENT[stage], status: 'PROCESSING', ...extra },
  });
}

async function markReady(materialId: string): Promise<void> {
  await db().material.update({
    where: { id: materialId },
    data: {
      status: 'READY',
      stage: 'DONE',
      stagePercent: 100,
      failureCode: null,
      failureMessage: null,
    },
  });
}

/** Wall-clock time per stage, logged on completion so a slow stage is obvious. */
function stageTimer() {
  const timings: string[] = [];
  const started = Date.now();

  return {
    async time<T>(label: string, work: () => Promise<T>): Promise<T> {
      const start = Date.now();
      try {
        return await work();
      } finally {
        timings.push(`${label} ${((Date.now() - start) / 1000).toFixed(1)}s`);
      }
    },
    summary: () => `${timings.join(' · ')} → ${((Date.now() - started) / 1000).toFixed(1)}s`,
  };
}

export async function runIngestion(
  materialId: string,
  logger: PipelineLogger,
  hooks: IngestionHooks = {},
): Promise<void> {
  const llm = createLlmClient(logger);
  const timer = stageTimer();

  try {
    const material = await db().material.findUnique({ where: { id: materialId } });
    if (!material) throw new Error(`Material ${materialId} disappeared before ingestion`);

    await setStage(materialId, 'EXTRACTING');

    // ── identical re-upload ──────────────────────────────────────────────────
    const previous = await findReusableMaterial(material.userId, material.contentHash, materialId);
    if (previous) {
      await timer.time('copy', () => copyMaterial(previous.id, materialId));
      await markReady(materialId);
      logger.info(`[ingest] ${materialId} ready (copied from an identical upload): ${timer.summary()}`);
      hooks.onReady?.(materialId);
      return;
    }

    // ── 1. extracting ────────────────────────────────────────────────────────
    const pages = await timer.time('extract', async () => {
      const extracted = await extractPdf(await getFile(material.storageKey));

      await db().pageText.deleteMany({ where: { materialId } });
      await db().pageText.createMany({
        data: extracted.pages.map((text, index) => ({ materialId, page: index + 1, text })),
      });
      return extracted.pages;
    });

    // ── 2. chunking ──────────────────────────────────────────────────────────
    await setStage(materialId, 'CHUNKING', { pageCount: pages.length });

    const drafts = chunkPages(pages);
    if (drafts.length === 0) {
      throw new ApiException(
        'NO_TEXT_LAYER',
        "We couldn't find any readable text in this PDF. Try a file where you can select the text with your cursor.",
      );
    }

    const storedChunks = await timer.time('chunk', async () => {
      await db().chunk.deleteMany({ where: { materialId } });
      return db().chunk.createManyAndReturn({
        data: drafts.map((chunk) => ({
          materialId,
          page: chunk.page,
          orderIndex: chunk.orderIndex,
          content: chunk.content,
          charCount: chunk.charCount,
          sectionTitle: chunk.sectionTitle,
        })),
        select: { id: true, content: true },
      });
    });

    // ── 3. course map ‖ embeddings ───────────────────────────────────────────
    // Independent: the model call waits on the network, the local embedder on
    // the CPU. Run back to back they cost the sum; overlapped, the longer one.
    await setStage(materialId, 'EXTRACTING_TOPICS');

    const [courseMap] = await Promise.all([
      timer.time('course map', () => extractCourseMap(drafts, llm, material.title)),
      timer.time('embed', () => embedChunks(storedChunks, logger)),
    ]);
    if (courseMap.usedFallback) logger.warn('[ingest] course map used the deterministic fallback');

    const topics = await timer.time('store topics', async () => {
      await db().misconceptionTag.deleteMany({ where: { materialId } });
      await db().misconceptionTag.createMany({
        data: courseMap.vocabulary.map((entry) => ({ materialId, ...entry })),
      });
      return storeTopics(materialId, courseMap.topics);
    });

    // ── 4. draft lessons ─────────────────────────────────────────────────────
    await setStage(materialId, 'BUILDING_LESSONS');
    await timer.time('drafts', () => writeDraftLessons(topics, drafts));

    // ── 5. ready ─────────────────────────────────────────────────────────────
    await markReady(materialId);
    logger.info(`[ingest] ${materialId} ready — ${topics.length} topics: ${timer.summary()}`);
    hooks.onReady?.(materialId);
  } catch (error) {
    const isApi = error instanceof ApiException;
    const code = isApi ? error.code : 'INTERNAL_ERROR';
    const message = isApi
      ? error.message
      : 'Something went wrong while preparing this file. Try uploading it again.';

    logger.error(`[ingest] ${materialId} failed: ${(error as Error).message}`);

    await db().material.update({
      where: { id: materialId },
      data: { status: 'FAILED', failureCode: code, failureMessage: message },
    });
  }
}

/**
 * Topics in one insert. Ids are minted here rather than by the database so
 * prerequisite slugs can be resolved to ids before the insert, instead of a
 * follow-up UPDATE per topic — each of which is a full round trip.
 */
export function planTopicRows(
  materialId: string,
  topics: TopicDraft[],
  mintId: () => string = randomUUID,
) {
  const ids = topics.map(() => mintId());
  const idBySlug = new Map<string, string>(topics.map((topic, index) => [topic.slug, ids[index]!]));

  return topics.map((topic, orderIndex) => ({
    id: ids[orderIndex]!,
    materialId,
    name: topic.name,
    slug: topic.slug,
    summary: topic.summary,
    orderIndex,
    sourcePages: topic.sourcePages,
    objectives: topic.objectives,
    keyTerms: topic.keyTerms,
    prerequisiteTopicIds: [
      ...new Set(
        topic.prerequisiteSlugs
          .map((slug) => idBySlug.get(slugify(slug)))
          .filter((id): id is string => Boolean(id) && id !== ids[orderIndex]),
      ),
    ],
  }));
}

async function storeTopics(materialId: string, topics: TopicDraft[]) {
  const rows = planTopicRows(materialId, topics);
  await db().topic.deleteMany({ where: { materialId } });
  await db().topic.createMany({ data: rows });
  return rows;
}

/**
 * An earlier upload of the same file by the same user, fully prepared.
 * Scoped to the user — hashes are never shared across accounts.
 *
 * Not one prepared without the model (its course map fell back, which leaves
 * exactly the generic vocabulary): copying it would carry heading-named topics
 * forward, when uploading again is how a student gets the real ones.
 */
async function findReusableMaterial(
  userId: string,
  contentHash: string | null,
  currentMaterialId: string,
) {
  if (!contentHash) return null;

  const candidate = await db().material.findFirst({
    where: {
      userId,
      contentHash,
      status: 'READY',
      id: { not: currentMaterialId },
      topics: { some: {} },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, pageCount: true, tags: { select: { tag: true } } },
  });

  if (!candidate || wasBuiltWithoutModel(candidate.tags.map((t) => t.tag))) return null;
  return candidate;
}

const GENERIC_TAGS = new Set(GENERIC_VOCABULARY.map((entry) => entry.tag));

/** The course map fell back: the vocabulary is exactly the generic list. */
export function wasBuiltWithoutModel(tags: string[]): boolean {
  return tags.length > 0 && tags.every((tag) => GENERIC_TAGS.has(tag));
}

/**
 * A re-upload of a file this student already prepared: copy the pages, chunks
 * (with their embeddings), topics, vocabulary and lessons instead of paying for
 * extraction, embedding and every model call again. Topics whose study notes
 * were never finished are copied as drafts, and the lesson worker picks them up.
 */
async function copyMaterial(fromId: string, toId: string): Promise<void> {
  await db().pageText.deleteMany({ where: { materialId: toId } });
  await db().chunk.deleteMany({ where: { materialId: toId } });
  await db().topic.deleteMany({ where: { materialId: toId } });
  await db().misconceptionTag.deleteMany({ where: { materialId: toId } });

  const [pages, topics, tags, source] = await Promise.all([
    db().pageText.findMany({ where: { materialId: fromId }, select: { page: true, text: true } }),
    db().topic.findMany({ where: { materialId: fromId }, orderBy: { orderIndex: 'asc' } }),
    db().misconceptionTag.findMany({
      where: { materialId: fromId },
      select: { tag: true, label: true, description: true },
    }),
    db().material.findUniqueOrThrow({ where: { id: fromId }, select: { pageCount: true } }),
  ]);

  await db().pageText.createMany({ data: pages.map((p) => ({ ...p, materialId: toId })) });
  await db().material.update({ where: { id: toId }, data: { pageCount: source.pageCount } });
  await db().misconceptionTag.createMany({ data: tags.map((t) => ({ ...t, materialId: toId })) });

  // Raw because Prisma cannot read or write the vector column.
  await db().$executeRawUnsafe(
    `INSERT INTO "Chunk" (id, "materialId", page, "orderIndex", content, "charCount", "sectionTitle", embedding)
     SELECT gen_random_uuid()::text, $1, page, "orderIndex", content, "charCount", "sectionTitle", embedding
     FROM "Chunk" WHERE "materialId" = $2`,
    toId,
    fromId,
  );

  const newId = new Map(topics.map((topic) => [topic.id, randomUUID()]));
  // Unfinished or failed notes get another try on the new upload; the model may
  // be available now when it was not then.
  const copiedStatus = (status: LessonStatus): LessonStatus =>
    status === 'READY' ? 'READY' : 'DRAFT';

  await db().topic.createMany({
    data: topics.map((topic) => ({
      id: newId.get(topic.id)!,
      materialId: toId,
      name: topic.name,
      slug: topic.slug,
      summary: topic.summary,
      orderIndex: topic.orderIndex,
      sourcePages: topic.sourcePages,
      objectives: topic.objectives,
      keyTerms: topic.keyTerms,
      prerequisiteTopicIds: topic.prerequisiteTopicIds.flatMap((id) => newId.get(id) ?? []),
      lessonStatus: copiedStatus(topic.lessonStatus),
    })),
  });

  const sections = await db().lessonSection.findMany({
    where: { topicId: { in: topics.map((t) => t.id) } },
  });
  if (sections.length > 0) {
    await db().lessonSection.createMany({
      data: sections.map(({ id: _id, topicId, ...section }) => ({
        ...section,
        topicId: newId.get(topicId)!,
      })),
    });
  }
}

const EMBED_BATCH = 32;

/**
 * One UPDATE per batch of chunks, not one per chunk.
 *
 * Each statement is a network round trip (~240 ms to the hosted database from
 * here), so a 100-chunk module spent ~24 s just writing vectors one at a time.
 */
export function buildEmbeddingUpdate(batch: { id: string; vector: number[] }[]): {
  sql: string;
  params: string[];
} {
  const values = batch.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(', ');
  return {
    sql: `UPDATE "Chunk" AS c SET embedding = v.embedding::vector FROM (VALUES ${values}) AS v(id, embedding) WHERE c.id = v.id`,
    params: batch.flatMap((row) => [row.id, toVectorLiteral(row.vector)]),
  };
}

async function embedChunks(
  chunks: { id: string; content: string }[],
  logger: PipelineLogger,
): Promise<void> {
  if (chunks.length === 0) return;

  const embedder = getEmbedder();

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);

    try {
      const vectors = await embedder.embed(batch.map((c) => c.content));
      const rows = batch.flatMap((chunk, index) =>
        vectors[index] ? [{ id: chunk.id, vector: vectors[index] }] : [],
      );
      if (rows.length === 0) continue;

      // Prisma cannot write an Unsupported() column; raw SQL is required.
      const { sql, params } = buildEmbeddingUpdate(rows);
      await db().$executeRawUnsafe(sql, ...params);
    } catch (error) {
      // Retrieval degrades to keyword search; it is not worth failing the upload.
      logger.warn(`[ingest] embedding batch failed: ${(error as Error).message}`);
    }
  }
}
