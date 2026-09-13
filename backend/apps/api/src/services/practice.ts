import type {
  PracticeSet,
  PracticeSetResult,
  Question,
  QuestionFeedback,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { buildSnippet } from '../modules/agent/citations.js';
import { randomUUID } from 'node:crypto';
import { generateQuestionsForTopics } from '../modules/agent/questions.js';
import type { RetrievedChunk } from '../modules/agent/retrieval.js';
import {
  STUB_MODEL_ID,
  createLlmClient,
  providerPausedFor,
  type LlmClient,
  type LlmLogger,
} from '../lib/llm.js';
import { fromWire, toQuestion } from '../lib/serializers.js';
import { loadResponseInputs } from './analytics-data.js';
import { listFindings, syncFindings } from './findings.js';
import { applyAdaptation } from './plan.js';
import type { PracticeSetKind, PracticeSetStatus } from '../generated/prisma/client.js';

/**
 * Practice sets.
 *
 * Answer-checking happens server-side only. `correctOptionId`, `explanation`,
 * and every `misconceptionTag` are stripped before a question reaches the
 * client — otherwise a judge with devtools open can read the whole quiz.
 */

/** Questions a topic keeps in stock, so a focused set of the default size opens at once. */
export const BANK_TARGET = 5;

/** The job queue, as far as creating a set needs it. */
export interface PracticeJobs {
  enqueuePracticeSet(setId: string): void;
}

type PracticeLogger = LlmLogger & { error: (msg: string) => void };

/**
 * Create a practice set without waiting on a model.
 *
 * If stored questions cover the set, it is ready at once. Otherwise it is
 * created GENERATING with whatever is already stored, a background job writes
 * the rest, and the client polls the set until it turns IN_PROGRESS. Writing
 * them inside this request made a five-topic diagnostic five sequential model
 * calls — minutes on a free tier — behind a button that could only spin.
 */
export async function createPracticeSet(params: {
  userId: string;
  materialId: string;
  kind: 'diagnostic' | 'focused' | 'retry';
  topicId?: string | undefined;
  count: number;
  jobs: PracticeJobs;
}): Promise<PracticeSet> {
  const { userId, materialId, kind, topicId, count, jobs } = params;

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
  let shortfall = 0;

  for (const { topic, needed } of planTopics(topics, count)) {
    const ids = await selectStoredQuestions({ userId, topicId: topic.id, needed, kind, emphasiseTag });
    questionIds.push(...ids);
    shortfall += needed - ids.length;
  }

  const reason =
    kind === 'focused' && emphasiseTag ? await buildFocusedReason(userId, topicId!) : null;

  const set = await db().practiceSet.create({
    data: {
      userId,
      materialId,
      topicId: topicId ?? null,
      kind: fromWire.practiceSetKind(kind) as PracticeSetKind,
      status: shortfall > 0 ? 'GENERATING' : 'IN_PROGRESS',
      reason,
      questionIds,
      targetCount: count,
    },
  });

  if (shortfall > 0) jobs.enqueuePracticeSet(set.id);

  return hydrateSet(set.id, userId);
}

/**
 * Which topics a set draws from, and how many questions each. A diagnostic
 * spreads the count across topics in course order; a focused set has one topic.
 */
export function planTopics<T>(topics: T[], count: number): { topic: T; needed: number }[] {
  const perTopic = Math.max(1, Math.ceil(count / Math.max(1, topics.length)));
  const plan: { topic: T; needed: number }[] = [];
  let allocated = 0;

  for (const topic of topics) {
    if (allocated >= count) break;
    const needed = Math.min(perTopic, count - allocated);
    plan.push({ topic, needed });
    allocated += needed;
  }

  return plan;
}

/** Stored questions for a topic: unseen first, tagged ones first for a focused set. */
async function selectStoredQuestions(params: {
  userId: string;
  topicId: string;
  needed: number;
  kind: 'diagnostic' | 'focused' | 'retry';
  emphasiseTag: string | undefined;
}): Promise<string[]> {
  const { userId, topicId, needed, kind, emphasiseTag } = params;

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
    // Rows written before question creation became transactional can still hold
    // the placeholder key. Serving one scores every answer wrong.
    where: { topicId, correctOptionId: { not: 'pending' } },
    include: { options: true },
  });

  // Model-written before fill-in-the-blank filler, then tagged ones for a focused
  // set: filler written while the model was unavailable must not keep crowding
  // out real questions once it is back.
  const rank = (q: (typeof stored)[number]) =>
    (q.generatedBy === STUB_MODEL_ID ? 0 : 2) + tagScore(q, emphasiseTag);

  return stored
    .filter((q) => !answeredIds.has(q.id))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, needed)
    .map((q) => q.id);
}

function tagScore(
  question: { options: { misconceptionTag: string | null }[] },
  tag: string | undefined,
): number {
  if (!tag) return 0;
  return question.options.some((o) => o.misconceptionTag === tag) ? 1 : 0;
}

export type FillOutcome = 'ready' | 'failed' | 'skipped';

/**
 * The background half of `createPracticeSet`: write what a GENERATING set is
 * missing — in one model call, however many topics it spans — then open it.
 * Anything still short is filled with questions the student has already seen
 * rather than leaving the set short; nothing at all means FAILED.
 */
export async function fillPracticeSet(setId: string, logger: PracticeLogger): Promise<FillOutcome> {
  const set = await db().practiceSet.findUnique({ where: { id: setId } });
  if (!set || set.status !== 'GENERATING') return 'skipped';

  const topics = await db().topic.findMany({
    where: { materialId: set.materialId, ...(set.topicId ? { id: set.topicId } : {}) },
    orderBy: { orderIndex: 'asc' },
  });
  const plan = planTopics(topics, set.targetCount);

  const have = await db().question.findMany({
    where: { id: { in: set.questionIds } },
    select: { topicId: true },
  });
  const haveByTopic = new Map<string, number>();
  for (const { topicId } of have) haveByTopic.set(topicId, (haveByTopic.get(topicId) ?? 0) + 1);

  const requests = plan
    .map(({ topic, needed }) => ({
      topicId: topic.id,
      topicName: topic.name,
      count: needed - (haveByTopic.get(topic.id) ?? 0),
    }))
    .filter((request) => request.count > 0);

  const emphasiseTag = set.topicId ? await activeTagForTopic(set.userId, set.topicId) : undefined;

  const generated = await generateAndStore({
    materialId: set.materialId,
    requests,
    emphasiseTag,
    llm: createLlmClient(logger),
    logger,
  });

  const ids = [...set.questionIds, ...generated];

  if (ids.length < set.targetCount) {
    const reused = await db().question.findMany({
      where: {
        topicId: { in: plan.map(({ topic }) => topic.id) },
        id: { notIn: ids },
        correctOptionId: { not: 'pending' },
      },
      orderBy: { createdAt: 'desc' },
      take: set.targetCount - ids.length,
      select: { id: true },
    });
    ids.push(...reused.map((q) => q.id));
  }

  if (ids.length === 0) {
    await db().practiceSet.update({ where: { id: setId }, data: { status: 'FAILED' } });
    return 'failed';
  }

  await db().practiceSet.update({
    where: { id: setId },
    data: { questionIds: ids.slice(0, set.targetCount), status: 'IN_PROGRESS' },
  });
  return 'ready';
}

/**
 * Keep a topic stocked with BANK_TARGET model-written questions, written in the
 * background after upload, so most practice sets are served from stock without
 * a model call. Skips a topic that is already stocked — including by a practice
 * set that got there first.
 *
 * Only model-written questions count and only they are stored: a bank is
 * permanent, and filling it with fill-in-the-blank filler while the provider is
 * out of quota would serve that filler long after the model is back. While it
 * is out, the job is deferred rather than run.
 */
export async function stockQuestionBank(
  topicId: string,
  llm: LlmClient,
  logger: PracticeLogger,
): Promise<'stocked' | 'skipped' | 'failed' | 'deferred'> {
  if (providerPausedFor() > 0) return 'deferred';

  const topic = await db().topic.findUnique({ where: { id: topicId } });
  if (!topic) return 'skipped';

  const stocked = await db().question.count({
    where: { topicId, correctOptionId: { not: 'pending' }, generatedBy: { not: STUB_MODEL_ID } },
  });
  if (stocked >= BANK_TARGET) return 'skipped';

  const ids = await generateAndStore({
    materialId: topic.materialId,
    requests: [{ topicId, topicName: topic.name, count: BANK_TARGET - stocked }],
    emphasiseTag: undefined,
    llm,
    logger,
    keepFallback: false,
  });

  if (ids.length > 0) return 'stocked';
  return providerPausedFor() > 0 ? 'deferred' : 'failed';
}

/** Generate questions for one or more topics in a single call, and store them. */
async function generateAndStore(params: {
  materialId: string;
  requests: { topicId: string; topicName: string; count: number }[];
  emphasiseTag: string | undefined;
  llm: LlmClient;
  logger: PracticeLogger;
  /**
   * Store the deterministic filler when the model fails. Yes for a set a
   * student is waiting on; no for the bank, which should wait for the model.
   */
  keepFallback?: boolean;
}): Promise<string[]> {
  const { materialId, requests, emphasiseTag, llm, logger, keepFallback = true } = params;
  if (requests.length === 0) return [];

  const topicRows = await db().topic.findMany({
    where: { id: { in: requests.map((r) => r.topicId) } },
    select: { id: true, sourcePages: true },
  });
  const pagesByTopic = new Map(topicRows.map((t) => [t.id, t.sourcePages]));

  const topics = await Promise.all(
    requests.map(async (request) => {
      const pages = pagesByTopic.get(request.topicId) ?? [];
      const rows = await db().chunk.findMany({
        where: { materialId, ...(pages.length > 0 ? { page: { in: pages } } : {}) },
        orderBy: { orderIndex: 'asc' },
        take: 12,
      });
      const chunks: RetrievedChunk[] = rows.map((c) => ({
        id: c.id,
        page: c.page,
        sectionTitle: c.sectionTitle,
        content: c.content,
        similarity: 1,
      }));
      return { ...request, chunks };
    }),
  );

  const vocabulary = await db().misconceptionTag.findMany({ where: { materialId } });

  const generated = await generateQuestionsForTopics({
    topics,
    vocabulary,
    llm,
    emphasiseTag,
    logger,
  });

  const ids: string[] = [];

  for (const question of generated) {
    if (question.usedFallback && !keepFallback) continue;

    const chunks = topics.find((t) => t.topicId === question.topicId)?.chunks ?? [];
    const chunk = chunks.find((c) => c.page === question.sourcePage) ?? chunks[0];

    // Option ids are minted here so the question can point at its correct one
    // in the same write — no placeholder key, no second statement, nothing
    // half-written to roll back. `validateQuestion` already guaranteed the
    // correct label is one of the four.
    const options = question.options.map((option) => ({ id: randomUUID(), ...option }));
    const correct = options.find((option) => option.label === question.correctLabel)!;

    const row = await db().question.create({
      data: {
        materialId,
        topicId: question.topicId,
        stem: question.stem,
        difficulty: fromWire.difficulty(question.difficulty),
        sourcePage: question.sourcePage,
        sourceChunkId: chunk?.id ?? null,
        correctOptionId: correct.id,
        explanation: question.explanation,
        // The deterministic builder and the model produce the same shape, so
        // recording the configured model for both would credit work it did
        // not do — and the AI-use page reads this field.
        generatedBy: question.usedFallback ? STUB_MODEL_ID : llm.modelId,
        options: {
          create: options.map((option) => ({
            id: option.id,
            label: option.label,
            text: option.text,
            misconceptionTag: option.misconceptionTag,
          })),
        },
      },
      select: { id: true },
    });

    ids.push(row.id);
  }

  if (generated.length < requests.reduce((sum, r) => sum + r.count, 0)) {
    logger.warn(`[practice] generated ${generated.length} of the questions requested`);
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

/** A set still being written, or one that could not be, cannot be answered or completed. */
function assertOpen(status: PracticeSetStatus): void {
  if (status === 'GENERATING') throw errors.practiceSetNotReady();
  if (status === 'FAILED') {
    throw errors.insufficientEvidence(
      'We could not build practice questions from this material. Start a new set to try again.',
    );
  }
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

  // Distinct questions, not response rows: re-answering one used to push this
  // past `questions.length`, and the runner seeds its starting index from it.
  const answered = await db().response.findMany({
    where: { practiceSetId: set.id },
    select: { questionId: true },
    distinct: ['questionId'],
  });
  const answeredCount = answered.length;

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
    targetCount: Math.max(set.targetCount, questions.length),
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
  assertOpen(set.status);

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
  assertOpen(set.status);

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
