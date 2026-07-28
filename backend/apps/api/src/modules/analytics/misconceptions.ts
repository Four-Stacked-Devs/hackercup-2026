import type { FindingResult, MasteryResult, ResponseInput } from './types.js';

/** The detection window: the N most recent responses in a topic. */
export const DETECTION_WINDOW = 5;

/** A tag must recur at least this often inside the window to become a finding. */
export const MIN_OCCURRENCES = 2;

/** Consecutive correct answers on tagged questions needed to resolve a finding. */
export const RESOLUTION_STREAK = 3;

function newestFirst(responses: ResponseInput[]): ResponseInput[] {
  return [...responses].sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime());
}

/**
 * Detect recurring misconceptions in one topic.
 *
 *   window = the 5 most recent responses in that topic
 *   group incorrect responses in the window by misconceptionTag
 *   if any tag occurs >= 2 times -> finding
 *
 * Note this is computed, not inferred. No model is asked what the student is
 * weak at; the tag counts come straight from logged responses.
 */
export function detectFindingsForTopic(
  topicId: string,
  responses: ResponseInput[],
): FindingResult[] {
  const inTopic = newestFirst(responses.filter((r) => r.topicId === topicId));
  const window = inTopic.slice(0, DETECTION_WINDOW);
  if (window.length === 0) return [];

  const byTag = new Map<string, ResponseInput[]>();

  for (const response of window) {
    if (response.isCorrect) continue;
    const tag = response.misconceptionTag;
    if (!tag) continue;
    const bucket = byTag.get(tag);
    if (bucket) bucket.push(response);
    else byTag.set(tag, [response]);
  }

  const findings: FindingResult[] = [];

  for (const [tag, evidence] of byTag) {
    if (evidence.length < MIN_OCCURRENCES) continue;
    // `window` is already newest-first, so `evidence` is too.
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

/** Detect across every topic present in the responses (or an explicit list). */
export function detectFindings(
  responses: ResponseInput[],
  topicIds?: string[],
): FindingResult[] {
  const topics = topicIds ?? [...new Set(responses.map((r) => r.topicId))];
  return topics.flatMap((topicId) => detectFindingsForTopic(topicId, responses));
}

/**
 * Rank findings: occurrences desc, then most recent, then lower mastery score.
 * `masteryByTopic` is optional; without it the third tiebreaker is skipped.
 */
export function rankFindings(
  findings: FindingResult[],
  masteryByTopic: MasteryResult[] = [],
): FindingResult[] {
  const scoreByTopic = new Map(masteryByTopic.map((m) => [m.topicId, m.score]));

  return [...findings].sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;

    const recency = b.lastOccurredAt.getTime() - a.lastOccurredAt.getTime();
    if (recency !== 0) return recency;

    // Lower mastery first. A null score (unknown) sorts last.
    const aScore = scoreByTopic.get(a.topicId) ?? null;
    const bScore = scoreByTopic.get(b.topicId) ?? null;
    if (aScore === null && bScore === null) return 0;
    if (aScore === null) return 1;
    if (bScore === null) return -1;
    return aScore - bScore;
  });
}

/**
 * A finding resolves when the same tag reaches 3 consecutive correct answers
 * on questions that carried it as a distractor.
 *
 * That closed loop — detected, practiced, resolved — is the most convincing
 * thing this engine can demonstrate, so it is computed explicitly rather than
 * inferred from a rising mastery score.
 */
export function isFindingResolved(
  responses: ResponseInput[],
  topicId: string,
  tag: string,
): boolean {
  const tagged = newestFirst(
    responses.filter(
      (r) => r.topicId === topicId && (r.questionDistractorTags ?? []).includes(tag),
    ),
  );

  if (tagged.length < RESOLUTION_STREAK) return false;
  return tagged.slice(0, RESOLUTION_STREAK).every((r) => r.isCorrect);
}
