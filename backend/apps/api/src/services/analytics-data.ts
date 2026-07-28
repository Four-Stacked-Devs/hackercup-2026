import type { EvidenceItem } from '@educlm/contracts';
import { db } from '../db/client.js';
import type { ResponseInput } from '../modules/analytics/index.js';

/**
 * Adapter between the database and the pure analytics engine.
 *
 * The engine takes plain objects and knows nothing about Prisma; this is the
 * only place that bridges the two.
 */

/**
 * Every response for a user within one material, shaped for the engine.
 *
 * `questionDistractorTags` carries the tags that appeared as distractors on
 * each question, which is what finding resolution is defined in terms of.
 */
export async function loadResponseInputs(
  userId: string,
  materialId: string,
): Promise<ResponseInput[]> {
  const rows = await db().response.findMany({
    where: { userId, question: { materialId } },
    include: { question: { include: { options: true } } },
    orderBy: { answeredAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    topicId: row.topicId,
    questionId: row.questionId,
    isCorrect: row.isCorrect,
    misconceptionTag: row.misconceptionTag,
    attemptNumber: row.attemptNumber,
    answeredAt: row.answeredAt,
    questionDistractorTags: row.question.options
      .map((option) => option.misconceptionTag)
      .filter((tag): tag is string => tag !== null),
  }));
}

/** Responses for a single topic, across every material. */
export async function loadTopicResponseInputs(
  userId: string,
  topicId: string,
): Promise<ResponseInput[]> {
  const rows = await db().response.findMany({
    where: { userId, topicId },
    include: { question: { include: { options: true } } },
    orderBy: { answeredAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    topicId: row.topicId,
    questionId: row.questionId,
    isCorrect: row.isCorrect,
    misconceptionTag: row.misconceptionTag,
    attemptNumber: row.attemptNumber,
    answeredAt: row.answeredAt,
    questionDistractorTags: row.question.options
      .map((option) => option.misconceptionTag)
      .filter((tag): tag is string => tag !== null),
  }));
}

/**
 * Hydrate response ids into the evidence a student can actually inspect.
 *
 * This is what answers "how does it know?" — every finding walks back to the
 * exact questions, the option chosen, and the page it came from.
 */
export async function loadEvidence(responseIds: string[]): Promise<EvidenceItem[]> {
  if (responseIds.length === 0) return [];

  const rows = await db().response.findMany({
    where: { id: { in: responseIds } },
    include: { question: { include: { options: true } } },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  // Preserve the caller's ordering (findings store evidence newest first).
  return responseIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];

    const selected = row.question.options.find((o) => o.id === row.selectedOptionId);
    const correct = row.question.options.find((o) => o.id === row.question.correctOptionId);

    return [
      {
        responseId: row.id,
        questionId: row.questionId,
        questionStem: row.question.stem,
        selectedOptionLabel: selected?.label ?? '?',
        selectedOptionText: selected?.text ?? '(this option no longer exists)',
        correctOptionText: correct?.text ?? '(this option no longer exists)',
        sourcePage: row.question.sourcePage,
        answeredAt: row.answeredAt.toISOString(),
      },
    ];
  });
}
