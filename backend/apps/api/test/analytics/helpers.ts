import type { ResponseInput } from '../../src/modules/analytics/index.js';

/** Fixed base time so every test is deterministic. */
export const T0 = new Date('2026-07-01T00:00:00.000Z');

/** Minutes after T0. */
export function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

let counter = 0;

export function resetIds(): void {
  counter = 0;
}

/**
 * Build a response. `minutesAfterT0` controls ordering — higher is more recent.
 */
export function response(partial: {
  topicId?: string;
  isCorrect: boolean;
  misconceptionTag?: string | null;
  minutesAfterT0: number;
  id?: string;
  questionId?: string;
  attemptNumber?: number;
  questionDistractorTags?: string[];
}): ResponseInput {
  counter += 1;
  return {
    id: partial.id ?? `resp_${counter}`,
    topicId: partial.topicId ?? 'topic_a',
    questionId: partial.questionId ?? `q_${counter}`,
    isCorrect: partial.isCorrect,
    misconceptionTag: partial.misconceptionTag ?? null,
    attemptNumber: partial.attemptNumber ?? 1,
    answeredAt: at(partial.minutesAfterT0),
    ...(partial.questionDistractorTags
      ? { questionDistractorTags: partial.questionDistractorTags }
      : {}),
  };
}

/** Shorthand: n responses in a row, oldest first, all in one topic. */
export function sequence(
  results: boolean[],
  opts: { topicId?: string; tag?: string; distractorTags?: string[] } = {},
): ResponseInput[] {
  return results.map((isCorrect, i) =>
    response({
      topicId: opts.topicId ?? 'topic_a',
      isCorrect,
      misconceptionTag: isCorrect ? null : (opts.tag ?? null),
      minutesAfterT0: i * 10,
      ...(opts.distractorTags ? { questionDistractorTags: opts.distractorTags } : {}),
    }),
  );
}
