import type { Confidence, MasteryBand } from '@educlm/contracts';
import type { MasteryResult, ResponseInput } from './types.js';

/** Recency decay. The most recent answer counts most. */
export const RECENCY_DECAY = 0.85;

/** Below this many responses we refuse to name a band. */
export const MIN_RESPONSES_FOR_BAND = 3;

export const BAND_THRESHOLDS = {
  strong: 0.8,
  developing: 0.5,
} as const;

/**
 * Recency-weighted accuracy over a single topic's responses.
 *
 *   sorted newest -> oldest, index k = 0,1,2,...
 *   weight(k) = 0.85 ^ k
 *   score     = Σ (weight(k) × isCorrect(k)) / Σ weight(k)
 *
 * Returns null for an empty input — there is nothing to average.
 */
export function computeRecencyWeightedScore(responses: ResponseInput[]): number | null {
  if (responses.length === 0) return null;

  const newestFirst = [...responses].sort(
    (a, b) => b.answeredAt.getTime() - a.answeredAt.getTime(),
  );

  let weightedCorrect = 0;
  let weightTotal = 0;

  newestFirst.forEach((response, k) => {
    const weight = RECENCY_DECAY ** k;
    weightTotal += weight;
    if (response.isCorrect) weightedCorrect += weight;
  });

  if (weightTotal === 0) return null;
  return weightedCorrect / weightTotal;
}

/** Confidence is a function of evidence volume only, never of the score. */
export function confidenceFor(responseCount: number): Confidence {
  if (responseCount === 0) return 'none';
  if (responseCount <= 5) return 'low';
  if (responseCount <= 9) return 'medium';
  return 'high';
}

export function bandForScore(score: number): MasteryBand {
  if (score >= BAND_THRESHOLDS.strong) return 'strong';
  if (score >= BAND_THRESHOLDS.developing) return 'developing';
  return 'needs_attention';
}

/**
 * Mastery for one topic.
 *
 * Under three responses this returns `insufficient_data` with a null score.
 * Do not soften that by guessing a band — honest uncertainty is a feature of
 * this product, not a limitation to hide.
 */
export function computeTopicMastery(
  topicId: string,
  responses: ResponseInput[],
): MasteryResult {
  const relevant = responses.filter((r) => r.topicId === topicId);
  const totalCount = relevant.length;
  const correctCount = relevant.filter((r) => r.isCorrect).length;
  const confidence = confidenceFor(totalCount);

  const lastAnsweredAt =
    totalCount === 0
      ? null
      : new Date(Math.max(...relevant.map((r) => r.answeredAt.getTime())));

  if (totalCount < MIN_RESPONSES_FOR_BAND) {
    return {
      topicId,
      band: 'insufficient_data',
      score: null,
      confidence,
      correctCount,
      totalCount,
      lastAnsweredAt,
    };
  }

  const score = computeRecencyWeightedScore(relevant);

  return {
    topicId,
    band: score === null ? 'insufficient_data' : bandForScore(score),
    score,
    confidence,
    correctCount,
    totalCount,
    lastAnsweredAt,
  };
}

/**
 * Mastery for many topics, ranked strongest → weakest.
 * Topics with insufficient data sort last: an unknown is not a weakness.
 */
export function computeMasteryByTopic(
  topicIds: string[],
  responses: ResponseInput[],
): MasteryResult[] {
  return topicIds
    .map((topicId) => computeTopicMastery(topicId, responses))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
}
