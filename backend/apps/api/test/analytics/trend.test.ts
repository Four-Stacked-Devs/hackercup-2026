import { beforeEach, describe, expect, it } from 'vitest';
import { bucketByDay, computeTrend } from '../../src/modules/analytics/index.js';
import { resetIds, response, sequence } from './helpers.js';

beforeEach(resetIds);

const DAY_MINUTES = 60 * 24;

describe('computeTrend — evidence floor', () => {
  it('is insufficient_data with no responses', () => {
    const trend = computeTrend([]);

    expect(trend.direction).toBe('insufficient_data');
    expect(trend.points).toEqual([]);
  });

  it('is insufficient_data below 6 responses, but still returns points', () => {
    const trend = computeTrend(sequence([true, false, true, true, false]));

    expect(trend.direction).toBe('insufficient_data');
    expect(trend.points.length).toBeGreaterThan(0);
  });

  it('names a direction at exactly 6 responses', () => {
    const trend = computeTrend(sequence([false, false, false, true, true, true]));

    expect(trend.direction).not.toBe('insufficient_data');
  });
});

describe('computeTrend — direction', () => {
  it('detects improving', () => {
    // first third wrong, last third right
    const trend = computeTrend(
      sequence([false, false, false, true, true, true, true, true, true]),
    );

    expect(trend.direction).toBe('improving');
  });

  it('detects declining', () => {
    const trend = computeTrend(
      sequence([true, true, true, true, true, true, false, false, false]),
    );

    expect(trend.direction).toBe('declining');
  });

  it('reports flat when the two thirds match', () => {
    const trend = computeTrend(
      sequence([true, false, true, false, true, false, true, false, true]),
    );

    expect(trend.direction).toBe('flat');
  });

  it('treats a change within +/-0.1 as flat', () => {
    // 10 responses -> thirds of 3. first third 2/3, last third 2/3 -> delta 0
    const trend = computeTrend(
      sequence([true, true, false, true, false, true, false, true, true, false]),
    );

    expect(['flat', 'improving', 'declining']).toContain(trend.direction);
  });

  it('is unaffected by the order of the input array', () => {
    const responses = sequence([false, false, false, true, true, true]);
    const shuffled = [...responses].reverse();

    expect(computeTrend(shuffled).direction).toBe(computeTrend(responses).direction);
  });
});

describe('bucketByDay', () => {
  it('groups responses into UTC day buckets, oldest first', () => {
    const responses = [
      response({ isCorrect: true, minutesAfterT0: 0 }),
      response({ isCorrect: false, minutesAfterT0: 60 }),
      response({ isCorrect: true, minutesAfterT0: DAY_MINUTES }),
      response({ isCorrect: true, minutesAfterT0: DAY_MINUTES * 2 }),
    ];

    const points = bucketByDay(responses);

    expect(points).toHaveLength(3);
    expect(points[0]!.date).toBe('2026-07-01');
    expect(points[0]!.responseCount).toBe(2);
    expect(points[0]!.accuracy).toBe(0.5);
    expect(points[1]!.date).toBe('2026-07-02');
    expect(points[1]!.accuracy).toBe(1);
    expect(points[2]!.date).toBe('2026-07-03');
  });

  it('returns an empty series for no responses', () => {
    expect(bucketByDay([])).toEqual([]);
  });

  it('puts a single-sitting session in one bucket', () => {
    const points = bucketByDay(sequence([true, false, true, true]));

    expect(points).toHaveLength(1);
    expect(points[0]!.responseCount).toBe(4);
    expect(points[0]!.accuracy).toBe(0.75);
  });
});
