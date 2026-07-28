import type { Confidence, MasteryBand, TrendDirection } from '@educlm/contracts';

/**
 * The analytics rules from apps/api/src/modules/analytics, reimplemented over
 * the mock's in-memory responses.
 *
 * Mock mode has to agree with live mode about bands, findings and adaptations —
 * a mock that computes something friendlier teaches you the wrong demo.
 */

export interface MockResponse {
  id: string;
  practiceSetId: string;
  questionId: string;
  topicId: string;
  selectedOptionId: string;
  isCorrect: boolean;
  misconceptionTag: string | null;
  /** Every tag offered as a distractor on that question. */
  questionDistractorTags: string[];
  answeredAt: Date;
}

export const RECENCY_DECAY = 0.85;
export const MIN_RESPONSES_FOR_BAND = 3;
export const DETECTION_WINDOW = 5;
export const MIN_OCCURRENCES = 2;
export const MIN_RESPONSES_FOR_TREND = 6;
export const TREND_DELTA = 0.1;

export function recencyWeightedScore(responses: MockResponse[]): number | null {
  if (responses.length === 0) return null;

  const newestFirst = [...responses].sort(
    (a, b) => b.answeredAt.getTime() - a.answeredAt.getTime(),
  );

  let weightedCorrect = 0;
  let weightTotal = 0;

  newestFirst.forEach((response, index) => {
    const weight = RECENCY_DECAY ** index;
    weightTotal += weight;
    if (response.isCorrect) weightedCorrect += weight;
  });

  return weightTotal === 0 ? null : weightedCorrect / weightTotal;
}

export function confidenceFor(count: number): Confidence {
  if (count === 0) return 'none';
  if (count <= 5) return 'low';
  if (count <= 9) return 'medium';
  return 'high';
}

export function bandForScore(score: number): MasteryBand {
  if (score >= 0.8) return 'strong';
  if (score >= 0.5) return 'developing';
  return 'needs_attention';
}

export interface MasteryComputation {
  band: MasteryBand;
  score: number | null;
  confidence: Confidence;
  correctCount: number;
  totalCount: number;
  lastAnsweredAt: string | null;
}

export function computeMastery(
  topicId: string,
  responses: MockResponse[],
): MasteryComputation {
  const relevant = responses.filter((r) => r.topicId === topicId);
  const totalCount = relevant.length;
  const correctCount = relevant.filter((r) => r.isCorrect).length;
  const confidence = confidenceFor(totalCount);
  const lastAnsweredAt =
    totalCount === 0
      ? null
      : new Date(Math.max(...relevant.map((r) => r.answeredAt.getTime()))).toISOString();

  if (totalCount < MIN_RESPONSES_FOR_BAND) {
    return {
      band: 'insufficient_data',
      score: null,
      confidence,
      correctCount,
      totalCount,
      lastAnsweredAt,
    };
  }

  const score = recencyWeightedScore(relevant);

  return {
    band: score === null ? 'insufficient_data' : bandForScore(score),
    score,
    confidence,
    correctCount,
    totalCount,
    lastAnsweredAt,
  };
}

export interface DetectedFinding {
  topicId: string;
  tag: string;
  occurrences: number;
  windowSize: number;
  evidenceResponseIds: string[];
  lastOccurredAt: Date;
}

export function detectFindingsForTopic(
  topicId: string,
  responses: MockResponse[],
): DetectedFinding[] {
  const inTopic = [...responses]
    .filter((r) => r.topicId === topicId)
    .sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime());

  const window = inTopic.slice(0, DETECTION_WINDOW);
  if (window.length === 0) return [];

  const byTag = new Map<string, MockResponse[]>();
  for (const response of window) {
    if (response.isCorrect || !response.misconceptionTag) continue;
    const bucket = byTag.get(response.misconceptionTag);
    if (bucket) bucket.push(response);
    else byTag.set(response.misconceptionTag, [response]);
  }

  const findings: DetectedFinding[] = [];
  for (const [tag, evidence] of byTag) {
    if (evidence.length < MIN_OCCURRENCES) continue;
    findings.push({
      topicId,
      tag,
      occurrences: evidence.length,
      windowSize: window.length,
      evidenceResponseIds: evidence.map((r) => r.id),
      lastOccurredAt: evidence[0]!.answeredAt,
    });
  }

  return findings;
}

export function computeTrend(responses: MockResponse[]): {
  direction: TrendDirection;
  points: { date: string; accuracy: number; responseCount: number }[];
} {
  const buckets = new Map<string, MockResponse[]>();
  for (const response of responses) {
    const key = response.answeredAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(response);
    else buckets.set(key, [response]);
  }

  const accuracy = (items: MockResponse[]) =>
    items.length === 0 ? 0 : items.filter((r) => r.isCorrect).length / items.length;

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      accuracy: accuracy(items),
      responseCount: items.length,
    }));

  if (responses.length < MIN_RESPONSES_FOR_TREND) {
    return { direction: 'insufficient_data', points };
  }

  const chronological = [...responses].sort(
    (a, b) => a.answeredAt.getTime() - b.answeredAt.getTime(),
  );
  const third = Math.floor(chronological.length / 3);
  const delta =
    accuracy(chronological.slice(chronological.length - third)) -
    accuracy(chronological.slice(0, third));

  return {
    direction: delta > TREND_DELTA ? 'improving' : delta < -TREND_DELTA ? 'declining' : 'flat',
    points,
  };
}
