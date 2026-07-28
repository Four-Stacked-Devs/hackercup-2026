import { beforeEach, describe, expect, it } from 'vitest';
import {
  bandForScore,
  computeMasteryByTopic,
  computeRecencyWeightedScore,
  computeTopicMastery,
  confidenceFor,
  RECENCY_DECAY,
} from '../../src/modules/analytics/index.js';
import { resetIds, response, sequence } from './helpers.js';

beforeEach(resetIds);

describe('computeTopicMastery — evidence floors', () => {
  it('returns insufficient_data with a null score for empty input', () => {
    const mastery = computeTopicMastery('topic_a', []);

    expect(mastery).toEqual({
      topicId: 'topic_a',
      band: 'insufficient_data',
      score: null,
      confidence: 'none',
      correctCount: 0,
      totalCount: 0,
      lastAnsweredAt: null,
    });
  });

  it('refuses to name a band at 1 response', () => {
    const mastery = computeTopicMastery('topic_a', sequence([true]));

    expect(mastery.band).toBe('insufficient_data');
    expect(mastery.score).toBeNull();
    expect(mastery.confidence).toBe('low');
    expect(mastery.totalCount).toBe(1);
  });

  it('refuses to name a band at 2 responses, even if both are correct', () => {
    const mastery = computeTopicMastery('topic_a', sequence([true, true]));

    expect(mastery.band).toBe('insufficient_data');
    expect(mastery.score).toBeNull();
    expect(mastery.correctCount).toBe(2);
  });

  it('names a band at exactly 3 responses — the floor', () => {
    const mastery = computeTopicMastery('topic_a', sequence([true, true, true]));

    expect(mastery.band).toBe('strong');
    expect(mastery.score).toBe(1);
    expect(mastery.confidence).toBe('low');
    expect(mastery.totalCount).toBe(3);
  });

  it('reports lastAnsweredAt as the most recent answer', () => {
    const responses = sequence([true, false, true]);
    const mastery = computeTopicMastery('topic_a', responses);

    expect(mastery.lastAnsweredAt?.toISOString()).toBe(
      responses[2]!.answeredAt.toISOString(),
    );
  });

  it('ignores responses belonging to other topics', () => {
    const responses = [
      ...sequence([true, true, true], { topicId: 'topic_a' }),
      ...sequence([false, false, false], { topicId: 'topic_b' }),
    ];

    expect(computeTopicMastery('topic_a', responses).score).toBe(1);
    expect(computeTopicMastery('topic_b', responses).score).toBe(0);
  });
});

describe('computeRecencyWeightedScore', () => {
  it('returns null for no responses', () => {
    expect(computeRecencyWeightedScore([])).toBeNull();
  });

  it('weights the most recent answer most heavily', () => {
    // Newest correct, two older wrong.
    const recentGood = [
      response({ isCorrect: false, minutesAfterT0: 0 }),
      response({ isCorrect: false, minutesAfterT0: 10 }),
      response({ isCorrect: true, minutesAfterT0: 20 }),
    ];
    // Newest wrong, two older correct.
    const recentBad = [
      response({ isCorrect: true, minutesAfterT0: 0 }),
      response({ isCorrect: true, minutesAfterT0: 10 }),
      response({ isCorrect: false, minutesAfterT0: 20 }),
    ];

    const good = computeRecencyWeightedScore(recentGood)!;
    const bad = computeRecencyWeightedScore(recentBad)!;

    // Same raw accuracy (1/3 vs 2/3 correct) but recency flips the ordering
    // relative to a naive average: the recent-good set scores far better than
    // its 33% raw accuracy would suggest.
    expect(good).toBeGreaterThan(1 / 3);
    expect(bad).toBeLessThan(2 / 3);
  });

  it('matches the documented formula exactly', () => {
    // newest -> oldest: correct, wrong, wrong
    const responses = [
      response({ isCorrect: false, minutesAfterT0: 0 }),
      response({ isCorrect: false, minutesAfterT0: 10 }),
      response({ isCorrect: true, minutesAfterT0: 20 }),
    ];

    const w0 = RECENCY_DECAY ** 0;
    const w1 = RECENCY_DECAY ** 1;
    const w2 = RECENCY_DECAY ** 2;
    const expected = w0 / (w0 + w1 + w2);

    expect(computeRecencyWeightedScore(responses)).toBeCloseTo(expected, 10);
  });

  it('is order-independent of input array order (sorts internally)', () => {
    const responses = sequence([true, false, true]);
    const shuffled = [responses[2]!, responses[0]!, responses[1]!];

    expect(computeRecencyWeightedScore(shuffled)).toBe(
      computeRecencyWeightedScore(responses),
    );
  });
});

describe('confidenceFor', () => {
  it.each([
    [0, 'none'],
    [1, 'low'],
    [2, 'low'],
    [3, 'low'],
    [5, 'low'],
    [6, 'medium'],
    [9, 'medium'],
    [10, 'high'],
    [50, 'high'],
  ])('%i responses -> %s', (count, expected) => {
    expect(confidenceFor(count)).toBe(expected);
  });
});

describe('bandForScore boundaries', () => {
  it.each([
    [1, 'strong'],
    [0.8, 'strong'],
    [0.799, 'developing'],
    [0.5, 'developing'],
    [0.499, 'needs_attention'],
    [0, 'needs_attention'],
  ])('score %d -> %s', (score, expected) => {
    expect(bandForScore(score)).toBe(expected);
  });
});

describe('computeMasteryByTopic', () => {
  it('ranks strongest to weakest and sorts unknowns last', () => {
    const responses = [
      ...sequence([true, true, true], { topicId: 'strong_topic' }),
      ...sequence([false, false, false], { topicId: 'weak_topic' }),
      ...sequence([true, true, false], { topicId: 'middle_topic' }),
      ...sequence([true], { topicId: 'unknown_topic' }),
    ];

    const ranked = computeMasteryByTopic(
      ['weak_topic', 'unknown_topic', 'middle_topic', 'strong_topic'],
      responses,
    );

    expect(ranked.map((m) => m.topicId)).toEqual([
      'strong_topic',
      'middle_topic',
      'weak_topic',
      'unknown_topic',
    ]);
    expect(ranked.at(-1)!.band).toBe('insufficient_data');
  });

  it('returns a result for a topic with no responses at all', () => {
    const ranked = computeMasteryByTopic(['empty_topic'], []);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.band).toBe('insufficient_data');
    expect(ranked[0]!.confidence).toBe('none');
  });
});
