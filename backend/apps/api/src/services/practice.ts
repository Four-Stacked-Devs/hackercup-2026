import type {
  PracticeSet,
  PracticeSetResult,
  Question,
  QuestionFeedback,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { buildSnippet } from '../modules/agent/citations.js';
import { generateQuestions } from '../modules/agent/questions.js';
import type { RetrievedChunk } from '../modules/agent/retrieval.js';
import { createLlmClient, type LlmLogger } from '../lib/llm.js';
import { fromWire, toQuestion } from '../lib/serializers.js';
import { loadResponseInputs } from './analytics-data.js';
import { listFindings, syncFindings } from './findings.js';
import { applyAdaptation } from './plan.js';
import type { PracticeSetKind } from '../generated/prisma/client.js';

/**
 * Practice sets.
 *
 * Answer-checking happens server-side only. `correctOptionId`, `explanation`,
 * and every `misconceptionTag` are stripped before a question reaches the
 * client — otherwise a judge with devtools open can read the whole quiz.
 */

export async function createPracticeSet(params: {
  userId: string;
  materialId: string;
  kind: 'diagnostic' | 'focused' | 'retry';
  topicId?: string | undefined;
  count: number;
  logger: LlmLogger & { error: (msg: string) => void };
}): Promise<PracticeSet> {
  const { userId, materialId, kind, topicId, count, logger } = params;

  const material = await db().material.findFirst({ where: { id: materialId, userId } });
  if (!material) throw errors.notFound('That material');
  if (material.status !== 'READY') throw errors.materialNotReady();

  const topics = await db().topic.findMany({
    where: { materialId, ...(topicId ? { id: topicId } : {}) },
    orderBy: { orderIndex: 'asc' },
  });
  if (topics.length === 0) throw errors.notFound('That topic');

  // For a focused set, bias distractors toward the student's active finding.
  const emphasiseTag = topicId ? await activeTagForTopic(userId, topicId) : undefined;

  const questionIds: string[] = [];
  const perTopic = Math.max(1, Math.ceil(count / topics.length));

  for (const topic of topics) {
    if (questionIds.length >= count) break;

    const needed = Math.min(perTopic, count - questionIds.length);
    const ids = await questionsForTopic({
      userId,
      materialId,
      topicId: topic.id,
      topicName: topic.name,
      needed,
      kind,
      emphasiseTag,
      logger,
    });

    questionIds.push(...ids);
  }

  if (questionIds.length === 0) {
    throw errors.insufficientEvidence(
      'We could not build practice questions from this material yet. Try again in a moment.',
    );
  }

  const reason =
    kind === 'focused' && emphasiseTag
      ? await buildFocusedReason(userId, topicId!)
      : null;

  const set = await db().practiceSet.create({
    data: {
      userId,
      materialId,
      topicId: topicId ?? null,
      kind: fromWire.practiceSetKind(kind) as PracticeSetKind,
      status: 'IN_PROGRESS',
      reason,
      questionIds: questionIds.slice(0, count),
    },
  });

  return hydrateSet(set.id, userId);
}

/** Reuse stored questions where possible; generate more only when short. */
async function questionsForTopic(params: {
  userId: string;
  materialId: string;
  topicId: string;
  topicName: string;
  needed: number;
  kind: 'diagnostic' | 'focused' | 'retry';
  emphasiseTag: string | undefined;
  logger: LlmLogger & { error: (msg: string) => void };
}): Promise<string[]> {
  const { userId, materialId, topicId, topicName, needed, kind, emphasiseTag, logger } = params;

  if (kind === 'retry') {
    const wrong = await db().response.findMany({
      where: { userId, topicId, isCorrect: false },
      orderBy: { answeredAt: 'desc' },
      distinct: ['questionId'],
      take: needed,
    });
    if (wrong.length >= needed) return wrong.map((r) => r.questionId);
  }

  const answered = await db().response.findMany({
    where: { userId, topicId },
    select: { questionId: true },
    distinct: ['questionId'],
  });
  const answeredIds = new Set(answered.map((a) => a.questionId));

  const stored = await db().question.findMany({
    where: { topicId },
    include: { options: true },
  });

  // Prefer unseen questions; for a focused set, prefer ones carrying the tag.
  const scored = stored
    .filter((q) => !answeredIds.has(q.id))
    .sort((a, b) => tagScore(b, emphasiseTag) - tagScore(a, emphasiseTag));

  const chosen = scored.slice(0, needed).map((q) => q.id);
  if (chosen.length >= needed) return chosen;

  // Not enough — generate the remainder.
  const missing = needed - chosen.length;
  const generated = await generateAndStore({
    materialId,
    topicId,
    topicName,
    count: missing,
    emphasiseTag,
    logger,
  });

  if (generated.length < missing) {
    // Fall back to repeating already-seen questions rather than a short set.
    const reused = stored
      .filter((q) => !chosen.includes(q.id) && !generated.includes(q.id))
      .slice(0, missing - generated.length)
      .map((q) => q.id);
    return [...chosen, ...generated, ...reused];
  }

  return [...chosen, ...generated];
}

function tagScore(
  question: { options: { misconceptionTag: string | null }[] },
  tag: string | undefined,
): number {
  if (!tag) return 0;
  return question.options.some((o) => o.misconceptionTag === tag) ? 1 : 0;
}

async function generateAndStore(params: {
  materialId: string;
  topicId: string;
  topicName: string;
  count: number;
  emphasiseTag: string | undefined;
  logger: LlmLogger & { error: (msg: string) => void };
}): Promise<string[]> {
  const { materialId, topicId, topicName, count, emphasiseTag, logger } = params;

  const topic = await db().topic.findUnique({ where: { id: topicId } });
  if (!topic) return [];

  const chunkRows = await db().chunk.findMany({
    where: {
      materialId,
      ...(topic.sourcePages.length > 0 ? { page: { in: topic.sourcePages } } : {}),
    },
    orderBy: { orderIndex: 'asc' },
    take: 12,
  });

  if (chunkRows.length === 0) return [];

  const chunks: RetrievedChunk[] = chunkRows.map((c) => ({
    id: c.id,
    page: c.page,
    sectionTitle: c.sectionTitle,
    content: c.content,
    similarity: 1,
  }));

  const vocabulary = await db().misconceptionTag.findMany({ where: { materialId } });
  const llm = createLlmClient(logger);

  const generated = await generateQuestions({
    topicName,
    chunks,
    count,
    vocabulary,
    llm,
    emphasiseTag,
    logger,
  });

  const ids: string[] = [];

  for (const question of generated) {
    const chunk = chunks.find((c) => c.page === question.sourcePage) ?? chunks[0]!;

    const row = await db().question.create({
      data: {
        materialId,
        topicId,
        stem: question.stem,
        difficulty: fromWire.difficulty(question.difficulty),
        sourcePage: question.sourcePage,
        sourceChunkId: chunk.id,
        correctOptionId: 'pending',
        explanation: question.explanation,
        generatedBy: llm.modelId,
        options: {
          create: question.options.map((option) => ({
            label: option.label,
            text: option.text,
            misconceptionTag: option.misconceptionTag,
          })),
        },
      },
      include: { options: true },
    });

    const correct = row.options.find((o) => o.label === question.correctLabel);
    if (!correct) continue;

    await db().question.update({
      where: { id: row.id },
      data: { correctOptionId: correct.id },
    });

    ids.push(row.id);
  }

  return ids;
}

async function activeTagForTopic(userId: string, topicId: string): Promise<string | undefined> {
  const finding = await db().misconceptionFinding.findFirst({
    where: { userId, topicId, status: 'ACTIVE' },
    orderBy: { occurrences: 'desc' },
  });
  return finding?.tag;
}

async function buildFocusedReason(userId: string, topicId: string): Promise<string | null> {
  const finding = await db().misconceptionFinding.findFirst({
    where: { userId, topicId, status: 'ACTIVE' },
    orderBy: { occurrences: 'desc' },
  });
  if (!finding) return null;

  return `Focused practice after ${finding.label.toLowerCase()} in ${finding.occurrences} of your last ${finding.windowSize} answers`;
}

// ─── Reading a set ───────────────────────────────────────────────────────────

export async function hydrateSet(setId: string, userId: string): Promise<PracticeSet> {
  const set = await db().practiceSet.findFirst({ where: { id: setId, userId } });
  if (!set) throw errors.notFound('That practice set');

  const rows = await db().question.findMany({
    where: { id: { in: set.questionIds } },
    include: { options: true, topic: true },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  // Preserve the stored order rather than the database's.
  const questions: Question[] = set.questionIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toQuestion(row, row.topic.name)] : [];
  });

  const answeredCount = await db().response.count({ where: { practiceSetId: set.id } });

  const topic = set.topicId ? await db().topic.findUnique({ where: { id: set.topicId } }) : null;

  return {
    id: set.id,
    materialId: set.materialId,
    topicId: set.topicId,
    topicName: topic?.name ?? null,
    kind: set.kind.toLowerCase() as PracticeSet['kind'],
    status: set.status.toLowerCase() as PracticeSet['status'],
    reason: set.reason,
    questions,
    answeredCount,
    createdAt: set.createdAt.toISOString(),
    completedAt: set.completedAt?.toISOString() ?? null,
  };
}

// ─── Recording an answer ─────────────────────────────────────────────────────

export async function recordResponse(params: {
  userId: string;
  setId: string;
  questionId: string;
  selectedOptionId: string;
  timeSpentMs: number;
  now: Date;
}): Promise<QuestionFeedback> {
  const { userId, setId, questionId, selectedOptionId, timeSpentMs, now } = params;

  const set = await db().practiceSet.findFirst({ where: { id: setId, userId } });
  if (!set) throw errors.notFound('That practice set');

  if (!set.questionIds.includes(questionId)) {
    throw errors.validation('That question is not part of this practice set.');
  }

  const question = await db().question.findUnique({
    where: { id: questionId },
    include: { options: true },
  });
  if (!question) throw errors.notFound('That question');

  const selected = question.options.find((o) => o.id === selectedOptionId);
  if (!selected) {
    throw errors.validation('That answer option does not belong to this question.');
  }

  // Correctness is decided here, from the stored answer — never by the client.
  const isCorrect = selected.id === question.correctOptionId;

  const previous = await db().response.count({ where: { userId, questionId } });

  const response = await db().response.create({
    data: {
      userId,
      practiceSetId: setId,
      questionId,
      topicId: question.topicId,
      selectedOptionId: selected.id,
      isCorrect,
      misconceptionTag: selected.misconceptionTag,
      timeSpentMs,
      attemptNumber: previous + 1,
      answeredAt: now,
    },
  });

  // Recompute findings immediately so a new one can surface mid-set.
  const responses = await loadResponseInputs(userId, set.materialId);
  await syncFindings({ userId, materialId: set.materialId, responses, now });

  const misconception = selected.misconceptionTag
    ? await db().misconceptionTag.findUnique({
        where: {
          materialId_tag: { materialId: set.materialId, tag: selected.misconceptionTag },
        },
      })
    : null;

  return {
    questionId,
    selectedOptionId: selected.id,
    correctOptionId: question.correctOptionId,
    isCorrect,
    explanationMarkdown: question.explanation,
    citation: await buildQuestionCitation(question.sourceChunkId, set.materialId, question.sourcePage),
    misconception: misconception
      ? {
          tag: misconception.tag,
          label: misconception.label,
          description: misconception.description,
        }
      : null,
    responseId: response.id,
  };
}

async function buildQuestionCitation(
  sourceChunkId: string | null,
  materialId: string,
  sourcePage: number,
) {
  const chunk =
    (sourceChunkId ? await db().chunk.findUnique({ where: { id: sourceChunkId } }) : null) ??
    (await db().chunk.findFirst({
      where: { materialId, page: sourcePage },
      orderBy: { orderIndex: 'asc' },
    }));

  if (!chunk) {
    return {
      chunkId: '',
      page: sourcePage,
      sectionTitle: null,
      snippet: `See page ${sourcePage} of your material.`,
    };
  }

  return {
    chunkId: chunk.id,
    page: chunk.page,
    sectionTitle: chunk.sectionTitle,
    snippet: buildSnippet(chunk.content),
  };
}

// ─── Completing a set ────────────────────────────────────────────────────────

export async function completeSet(params: {
  userId: string;
  setId: string;
  now: Date;
}): Promise<PracticeSetResult> {
  const { userId, setId, now } = params;

  const set = await db().practiceSet.findFirst({ where: { id: setId, userId } });
  if (!set) throw errors.notFound('That practice set');

  await db().practiceSet.update({
    where: { id: setId },
    data: { status: 'COMPLETED', completedAt: now },
  });

  const responses = await db().response.findMany({
    where: { practiceSetId: setId },
    include: { topic: true },
  });

  const byTopicMap = new Map<string, { topicName: string; correct: number; total: number }>();
  for (const response of responses) {
    const entry = byTopicMap.get(response.topicId) ?? {
      topicName: response.topic.name,
      correct: 0,
      total: 0,
    };
    entry.total += 1;
    if (response.isCorrect) entry.correct += 1;
    byTopicMap.set(response.topicId, entry);
  }

  const inputs = await loadResponseInputs(userId, set.materialId);
  const sync = await syncFindings({
    userId,
    materialId: set.materialId,
    responses: inputs,
    now,
  });

  const planUpdated = await applyAdaptation({
    userId,
    materialId: set.materialId,
    responses: inputs,
    now,
  });

  const active = await listFindings({ userId, materialId: set.materialId, responses: inputs });
  const newFindings = active.filter((finding) => sync.created.includes(finding.id));

  return {
    setId,
    correctCount: responses.filter((r) => r.isCorrect).length,
    total: responses.length,
    byTopic: [...byTopicMap.entries()].map(([topicId, entry]) => ({
      topicId,
      topicName: entry.topicName,
      correct: entry.correct,
      total: entry.total,
    })),
    newFindings,
    planUpdated,
  };
}
