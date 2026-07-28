import type { IngestionStage } from '../../generated/prisma/enums.js';
import type { Topic } from '../../generated/prisma/client.js';
import { db } from '../../db/client.js';
import { getEmbedder, toVectorLiteral } from '../../lib/embeddings.js';
import { ApiException } from '../../lib/errors.js';
import { createLlmClient, type LlmLogger } from '../../lib/llm.js';
import { extractPdf } from '../../lib/pdf.js';
import { getFile } from '../../lib/storage.js';
import { chunkPages, type ChunkDraft } from './chunk.js';
import { buildLessonSections } from './lessons.js';
import { extractTopics, slugify } from './topics.js';
import { buildVocabulary } from './vocabulary.js';

/**
 * The ingestion pipeline.
 *
 * Six stages, each writing `stage`/`stagePercent` as it goes so the client's
 * 1.5s poll always has something honest to show. Every stage is idempotent:
 * re-running clears that stage's output first, so a retry never duplicates.
 *
 * Target: under 60 seconds for a 30-page module.
 */

export interface PipelineLogger extends LlmLogger {
  error: (msg: string) => void;
}

const STAGE_PERCENT: Record<IngestionStage, number> = {
  EXTRACTING: 10,
  CHUNKING: 30,
  EXTRACTING_TOPICS: 45,
  EMBEDDING: 65,
  BUILDING_LESSONS: 85,
  DONE: 100,
};

async function setStage(materialId: string, stage: IngestionStage): Promise<void> {
  await db().material.update({
    where: { id: materialId },
    data: { stage, stagePercent: STAGE_PERCENT[stage], status: 'PROCESSING' },
  });
}

export async function runIngestion(
  materialId: string,
  logger: PipelineLogger,
): Promise<void> {
  const llm = createLlmClient(logger);

  try {
    const material = await db().material.findUnique({ where: { id: materialId } });
    if (!material) throw new Error(`Material ${materialId} disappeared before ingestion`);

    // ── 1. extracting ────────────────────────────────────────────────────────
    await setStage(materialId, 'EXTRACTING');

    const reused = await reuseExtraction(material.userId, material.contentHash, materialId);
    let pages: string[];

    if (reused) {
      logger.info(`[ingest] reusing extraction from an identical earlier upload`);
      pages = reused;
    } else {
      const bytes = await getFile(material.storageKey);
      const extracted = await extractPdf(bytes);
      pages = extracted.pages;

      await db().material.update({
        where: { id: materialId },
        data: { pageCount: extracted.pageCount },
      });
    }

    await db().pageText.deleteMany({ where: { materialId } });
    await db().pageText.createMany({
      data: pages.map((text, index) => ({ materialId, page: index + 1, text })),
    });

    if (reused) {
      await db().material.update({
        where: { id: materialId },
        data: { pageCount: pages.length },
      });
    }

    // ── 2. chunking ──────────────────────────────────────────────────────────
    await setStage(materialId, 'CHUNKING');

    const drafts = chunkPages(pages);
    if (drafts.length === 0) {
      throw new ApiException(
        'NO_TEXT_LAYER',
        "We couldn't find any readable text in this PDF. Try a file where you can select the text with your cursor.",
      );
    }

    await db().chunk.deleteMany({ where: { materialId } });
    await db().chunk.createMany({
      data: drafts.map((chunk) => ({
        materialId,
        page: chunk.page,
        orderIndex: chunk.orderIndex,
        content: chunk.content,
        charCount: chunk.charCount,
        sectionTitle: chunk.sectionTitle,
      })),
    });

    const storedChunks = await db().chunk.findMany({
      where: { materialId },
      orderBy: { orderIndex: 'asc' },
    });

    // ── 3. extracting_topics ─────────────────────────────────────────────────
    await setStage(materialId, 'EXTRACTING_TOPICS');

    const { topics, usedFallback } = await extractTopics(drafts, llm);
    if (usedFallback) logger.warn('[ingest] topic extraction used the deterministic fallback');

    await db().topic.deleteMany({ where: { materialId } });

    const createdTopics: Topic[] = [];
    for (const [orderIndex, topic] of topics.entries()) {
      createdTopics.push(
        await db().topic.create({
          data: {
            materialId,
            name: topic.name,
            slug: topic.slug,
            summary: topic.summary,
            orderIndex,
            sourcePages: topic.sourcePages,
            prerequisiteTopicIds: [],
          },
        }),
      );
    }

    // Resolve prerequisite slugs to ids now that every topic has one.
    const idBySlug = new Map(createdTopics.map((t) => [t.slug, t.id]));
    for (const [index, topic] of topics.entries()) {
      const ids = topic.prerequisiteSlugs
        .map((slug) => idBySlug.get(slugify(slug)))
        .filter((id): id is string => Boolean(id) && id !== createdTopics[index]!.id);

      if (ids.length > 0) {
        await db().topic.update({
          where: { id: createdTopics[index]!.id },
          data: { prerequisiteTopicIds: ids },
        });
      }
    }

    // Controlled misconception vocabulary for this material.
    const { entries } = await buildVocabulary(material.title, topics, llm);
    await db().misconceptionTag.deleteMany({ where: { materialId } });
    await db().misconceptionTag.createMany({
      data: entries.map((entry) => ({ materialId, ...entry })),
    });

    // ── 4. embedding ─────────────────────────────────────────────────────────
    await setStage(materialId, 'EMBEDDING');
    await embedChunks(storedChunks, logger);

    // ── 5. building_lessons ──────────────────────────────────────────────────
    await setStage(materialId, 'BUILDING_LESSONS');

    for (const topic of createdTopics) {
      const topicChunks = selectChunksForTopic(drafts, topic.sourcePages);
      if (topicChunks.length === 0) continue;

      const { sections } = await buildLessonSections(topic.name, topicChunks, llm);

      await db().lessonSection.deleteMany({ where: { topicId: topic.id } });
      await db().lessonSection.createMany({
        data: sections.map((section) => ({
          topicId: topic.id,
          heading: section.heading,
          level: section.level,
          bodyMarkdown: section.bodyMarkdown,
          orderIndex: section.orderIndex,
          sourcePages: section.sourcePages,
          kind: section.kind.toUpperCase() as 'TEXT' | 'TABLE' | 'EQUATION' | 'FIGURE_DESCRIPTION',
          needsReview: section.needsReview,
          generatedBy: llm.modelId,
        })),
      });
    }

    // ── 6. done ──────────────────────────────────────────────────────────────
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

    logger.info(`[ingest] ${materialId} ready — ${createdTopics.length} topics`);
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
 * Section 8: a re-uploaded identical file (hash match) reuses the previous
 * extraction. Scoped to the same user — hashes are never shared across users.
 */
async function reuseExtraction(
  userId: string,
  contentHash: string | null,
  currentMaterialId: string,
): Promise<string[] | null> {
  if (!contentHash) return null;

  const previous = await db().material.findFirst({
    where: {
      userId,
      contentHash,
      status: 'READY',
      id: { not: currentMaterialId },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!previous) return null;

  const pages = await db().pageText.findMany({
    where: { materialId: previous.id },
    orderBy: { page: 'asc' },
  });

  return pages.length > 0 ? pages.map((p) => p.text) : null;
}

/** Chunks whose page falls inside the topic's page range. */
function selectChunksForTopic(chunks: ChunkDraft[], sourcePages: number[]): ChunkDraft[] {
  if (sourcePages.length === 0) return [];
  const pages = new Set(sourcePages);
  const min = Math.min(...sourcePages);
  const max = Math.max(...sourcePages);

  const exact = chunks.filter((c) => pages.has(c.page));
  if (exact.length > 0) return exact;

  // The model may list only the first page of a range.
  return chunks.filter((c) => c.page >= min && c.page <= max);
}

const EMBED_BATCH = 32;

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

      for (const [index, chunk] of batch.entries()) {
        const vector = vectors[index];
        if (!vector) continue;
        // Prisma cannot write an Unsupported() column; raw SQL is required.
        await db().$executeRawUnsafe(
          `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
          toVectorLiteral(vector),
          chunk.id,
        );
      }
    } catch (error) {
      // Retrieval degrades to keyword search; it is not worth failing the upload.
      logger.warn(`[ingest] embedding batch failed: ${(error as Error).message}`);
    }
  }
}
