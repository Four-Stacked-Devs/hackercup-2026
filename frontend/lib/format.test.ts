import { describe, expect, it } from 'vitest';
import type { PlanStep } from '@educlm/contracts';
import { pageLabel, planProgress, shortDate, stepLabel } from './format';

const step = (status: PlanStep['status'], estimatedMinutes = 6): PlanStep =>
  ({
    id: `step_${Math.random().toString(36).slice(2)}`,
    kind: 'read',
    title: 'A step',
    description: null,
    topicId: null,
    targetType: 'lesson',
    targetId: null,
    targetPage: null,
    estimatedMinutes,
    status,
    orderIndex: 0,
    insertedByAdaptation: false,
  }) as unknown as PlanStep;

describe('planProgress', () => {
  it('reaches 100% once every outstanding step is done', () => {
    // Five done, five skipped: nothing is left, so nothing should still be owed.
    const steps = [
      ...Array.from({ length: 5 }, () => step('completed')),
      ...Array.from({ length: 5 }, () => step('skipped')),
    ];

    const progress = planProgress(steps);

    expect(progress.remainingMinutes).toBe(0);
    expect(progress.completion).toBe(1);
    expect(progress.completed).toBe(5);
    expect(progress.total).toBe(5);
  });

  it('uses the same denominator as the time it reports as left', () => {
    const steps = [step('completed', 8), step('pending', 6), step('skipped', 30)];

    const progress = planProgress(steps);

    // The skipped 30 minutes are in neither the time left nor the denominator.
    expect(progress.remainingMinutes).toBe(6);
    expect(progress.total).toBe(2);
    expect(progress.completion).toBe(0.5);
  });

  it('reports no percentage when nothing is outstanding at all', () => {
    expect(planProgress([]).completion).toBeNull();
    expect(planProgress([step('skipped')]).completion).toBeNull();
  });
});

describe('shortDate', () => {
  it('reads a UTC day key as the day it names, in any timezone', () => {
    // The analytics trend keys buckets by UTC day. Parsed as an instant and
    // formatted locally, this rendered as 8 Sep anywhere west of UTC.
    expect(shortDate('2026-09-09')).toBe('Sep 9');
  });
});

describe('stepLabel', () => {
  it('gives every module the same template labels', () => {
    expect(stepLabel({ kind: 'read', insertedByAdaptation: false })).toBe('Read the study notes');
    expect(stepLabel({ kind: 'practice', insertedByAdaptation: false })).toBe('Practise 5 questions');
    expect(stepLabel({ kind: 'practice', insertedByAdaptation: true })).toBe('Focused practice set');
    expect(stepLabel({ kind: 'review', insertedByAdaptation: true })).toBe('Review the study notes');
  });
});

describe('pageLabel', () => {
  it('compresses runs of pages the way the server does', () => {
    expect(pageLabel([30, 31, 32, 34])).toBe('pp. 30–32, 34');
    expect(pageLabel([7])).toBe('p. 7');
    expect(pageLabel([])).toBe('');
  });
});
