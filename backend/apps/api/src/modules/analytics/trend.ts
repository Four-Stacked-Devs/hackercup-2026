import type { ResponseInput, TrendPointResult, TrendResult } from './types.js';

/** Below this many responses we will not name a direction. */
export const MIN_RESPONSES_FOR_TREND = 6;

/** Accuracy delta between the last third and the first third that counts as a move. */
export const TREND_DELTA = 0.1;

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function accuracy(responses: ResponseInput[]): number {
  if (responses.length === 0) return 0;
  return responses.filter((r) => r.isCorrect).length / responses.length;
}

/** Daily buckets, oldest first — the series behind the progress chart. */
export function bucketByDay(responses: ResponseInput[]): TrendPointResult[] {
  const buckets = new Map<string, ResponseInput[]>();

  for (const response of responses) {
    const key = utcDayKey(response.answeredAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(response);
    else buckets.set(key, [response]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      accuracy: accuracy(items),
      responseCount: items.length,
    }));
}

/**
 * Direction compares the mean accuracy of the most recent third against the
 * first third: > +0.1 improving, < -0.1 declining, else flat.
 *
 * Thirds are taken over RESPONSES, not over daily buckets. The spec's own
 * "fewer than 6 total responses" floor is expressed in responses, and a
 * bucket-based split would collapse to a single bucket whenever a student does
 * all their practice in one sitting — which is the common case.
 */
export function computeTrend(responses: ResponseInput[]): TrendResult {
  const points = bucketByDay(responses);

  if (responses.length < MIN_RESPONSES_FOR_TREND) {
    return { direction: 'insufficient_data', points };
  }

  const chronological = [...responses].sort(
    (a, b) => a.answeredAt.getTime() - b.answeredAt.getTime(),
  );

  const third = Math.floor(chronological.length / 3);
  const firstThird = chronological.slice(0, third);
  const lastThird = chronological.slice(chronological.length - third);

  const delta = accuracy(lastThird) - accuracy(firstThird);

  const direction =
    delta > TREND_DELTA ? 'improving' : delta < -TREND_DELTA ? 'declining' : 'flat';

  return { direction, points };
}
