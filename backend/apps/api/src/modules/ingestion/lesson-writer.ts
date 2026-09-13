import { db } from '../../db/client.js';
import {
  STUB_MODEL_ID,
  providerPausedFor,
  type LlmClient,
  type LlmLogger,
} from '../../lib/llm.js';
import type { ChunkDraft } from './chunk.js';
import { buildLessonSections, buildSectionsStructurally, type SectionDraft } from './lessons.js';

/**
 * Where a topic's lesson comes from, in two passes.
 *
 * Writing AI study notes takes one model call per topic — minutes for a long
 * module on a free tier — and nothing but the lesson itself needs them. So
 * ingestion writes a DRAFT for every topic at once (the structural reformat:
 * the material's own text, no model call) and the material turns READY. The
 * lesson worker then replaces each draft with study notes in the background.
 */

/** Chunks whose page falls inside the topic's page range. */
export function selectChunksForTopic<T extends { page: number }>(
  chunks: T[],
  sourcePages: number[],
): T[] {
  if (sourcePages.length === 0) return [];
  const pages = new Set(sourcePages);
  const min = Math.min(...sourcePages);
  const max = Math.max(...sourcePages);

  const exact = chunks.filter((c) => pages.has(c.page));
  if (exact.length > 0) return exact;

  // The model may list only the first page of a range.
  return chunks.filter((c) => c.page >= min && c.page <= max);
}

function toRows(topicId: string, sections: SectionDraft[], generatedBy: string) {
  return sections.map((section) => ({
    topicId,
    heading: section.heading,
    level: section.level,
    bodyMarkdown: section.bodyMarkdown,
    orderIndex: section.orderIndex,
    sourcePages: section.sourcePages,
    kind: section.kind.toUpperCase() as 'TEXT' | 'TABLE' | 'EQUATION' | 'FIGURE_DESCRIPTION',
    needsReview: section.needsReview,
    generatedBy,
  }));
}

/**
 * A readable lesson for every topic, with no model call, in two queries.
 *
 * `generatedBy` is the stub id: the lesson header and the AI-use page show the
 * student that this text is their material's own, not the model's. A topic no
 * chunk resolves to gets no draft and is marked FAILED, so the worker skips it.
 */
export async function writeDraftLessons(
  topics: { id: string; sourcePages: number[] }[],
  chunks: ChunkDraft[],
): Promise<void> {
  const empty: string[] = [];

  const rows = topics.flatMap((topic) => {
    const topicChunks = selectChunksForTopic(chunks, topic.sourcePages);
    if (topicChunks.length === 0) empty.push(topic.id);
    return toRows(topic.id, buildSectionsStructurally(topicChunks), STUB_MODEL_ID);
  });

  await db().lessonSection.deleteMany({ where: { topicId: { in: topics.map((t) => t.id) } } });
  if (rows.length > 0) await db().lessonSection.createMany({ data: rows });

  if (empty.length > 0) {
    await db().topic.updateMany({
      where: { id: { in: empty } },
      data: { lessonStatus: 'FAILED' },
    });
  }
}

/** `deferred`: the provider is out of quota; the draft stays DRAFT and is retried later. */
export type StudyNotesOutcome = 'ready' | 'failed' | 'skipped' | 'deferred';

/**
 * Replace one topic's draft with AI study notes.
 *
 * The swap is one transaction, so a reader sees either the whole draft or the
 * whole notes, never a mix. On a model failure the draft stays and the topic is
 * marked FAILED rather than overwritten with the same draft again.
 */
export async function writeStudyNotes(
  topicId: string,
  llm: LlmClient,
  logger: LlmLogger,
): Promise<StudyNotesOutcome> {
  const topic = await db().topic.findUnique({ where: { id: topicId } });
  if (!topic || topic.lessonStatus === 'READY' || topic.sourcePages.length === 0) {
    return 'skipped';
  }

  await db().topic.update({ where: { id: topicId }, data: { lessonStatus: 'WRITING' } });

  const inRange = await db().chunk.findMany({
    where: {
      materialId: topic.materialId,
      page: { gte: Math.min(...topic.sourcePages), lte: Math.max(...topic.sourcePages) },
    },
    orderBy: { orderIndex: 'asc' },
    select: { page: true, orderIndex: true, content: true, charCount: true, sectionTitle: true },
  });

  const chunks = selectChunksForTopic(inRange, topic.sourcePages);
  if (chunks.length === 0) {
    await db().topic.update({ where: { id: topicId }, data: { lessonStatus: 'FAILED' } });
    return 'failed';
  }

  const { sections, usedFallback } = await buildLessonSections(
    topic.name,
    chunks,
    llm,
    topic.summary,
  );

  if (usedFallback) {
    // Out of quota is temporary. Recording FAILED would keep the draft for good;
    // DRAFT lets the worker write the notes once the provider is back.
    if (providerPausedFor() > 0) {
      await db().topic.update({ where: { id: topicId }, data: { lessonStatus: 'DRAFT' } });
      return 'deferred';
    }
    logger.warn(`[lessons] study notes for "${topic.name}" fell back; keeping the draft`);
    await db().topic.update({ where: { id: topicId }, data: { lessonStatus: 'FAILED' } });
    return 'failed';
  }

  await db().$transaction([
    db().lessonSection.deleteMany({ where: { topicId } }),
    db().lessonSection.createMany({ data: toRows(topicId, sections, llm.modelId) }),
    db().topic.update({ where: { id: topicId }, data: { lessonStatus: 'READY' } }),
  ]);

  return 'ready';
}
