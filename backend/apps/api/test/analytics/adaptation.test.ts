import { beforeEach, describe, expect, it } from 'vitest';
import {
  adaptPlan,
  buildAdaptationReason,
  computeMasteryByTopic,
  revertAdaptation,
  type ActiveFindingInput,
  type PlanStepInput,
} from '../../src/modules/analytics/index.js';
import { resetIds, sequence } from './helpers.js';

beforeEach(resetIds);

const NOW = new Date('2026-07-10T12:00:00.000Z');

/** Deterministic ids so assertions are stable. */
const idFactory = (seed: string) => `step_${seed}`;

function step(partial: Partial<PlanStepInput> & { id: string; orderIndex: number }): PlanStepInput {
  return {
    kind: 'read',
    title: `Step ${partial.id}`,
    description: '',
    topicId: null,
    targetType: null,
    targetId: null,
    targetPage: null,
    estimatedMinutes: 5,
    status: 'pending',
    insertedByAdaptation: false,
    ...partial,
  };
}

const finding: ActiveFindingInput = {
  id: 'finding_1',
  topicId: 'topic_conditionals',
  tag: 'assignment_vs_comparison',
  label: 'Confusing assignment with comparison',
  occurrences: 3,
  windowSize: 5,
  status: 'active',
};

const topicNames = new Map([['topic_conditionals', 'Conditionals']]);

/** Mastery where the finding's topic is genuinely weak. */
const weakMastery = computeMasteryByTopic(
  ['topic_conditionals'],
  sequence([false, false, false], { topicId: 'topic_conditionals' }),
);

/** Mastery where the topic is fine, so no adaptation should fire. */
const strongMastery = computeMasteryByTopic(
  ['topic_conditionals'],
  sequence([true, true, true], { topicId: 'topic_conditionals' }),
);

describe('adaptPlan — insertion', () => {
  it('inserts review then practice before the next pending step', () => {
    const steps = [
      step({ id: 'a', orderIndex: 0, status: 'completed' }),
      step({ id: 'b', orderIndex: 1, status: 'pending', title: 'Read: Loops' }),
      step({ id: 'c', orderIndex: 2, status: 'pending' }),
    ];

    const result = adaptPlan({
      steps,
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(true);
    expect(result.steps.map((s) => s.id)).toEqual([
      'a',
      'step_review-finding_1',
      'step_practice-finding_1',
      'b',
      'c',
    ]);
    expect(result.steps[1]!.kind).toBe('review');
    expect(result.steps[2]!.kind).toBe('practice');
  });

  it('flags every inserted step so the change is never silent', () => {
    const result = adaptPlan({
      steps: [step({ id: 'a', orderIndex: 0 })],
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    const inserted = result.steps.filter((s) => s.insertedByAdaptation);

    expect(inserted).toHaveLength(2);
    expect(inserted.every((s) => s.topicId === 'topic_conditionals')).toBe(true);
  });

  it('records what changed and why', () => {
    const result = adaptPlan({
      steps: [step({ id: 'a', orderIndex: 0, title: 'Read: Loops' })],
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adaptation).toEqual({
      at: NOW,
      reason: 'Confusing assignment with comparison in 3 of your last 5 answers',
      triggeredByFindingId: 'finding_1',
      previousStepTitle: 'Read: Loops',
      newStepTitle: 'Review: Conditionals',
    });
  });

  it('re-indexes orderIndex contiguously from zero', () => {
    const steps = [
      step({ id: 'a', orderIndex: 0, status: 'completed' }),
      step({ id: 'b', orderIndex: 1 }),
    ];

    const result = adaptPlan({
      steps,
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.steps.map((s) => s.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it('appends at the end when no pending step remains', () => {
    const steps = [
      step({ id: 'a', orderIndex: 0, status: 'completed' }),
      step({ id: 'b', orderIndex: 1, status: 'completed' }),
    ];

    const result = adaptPlan({
      steps,
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(true);
    expect(result.steps.map((s) => s.id)).toEqual([
      'a',
      'b',
      'step_review-finding_1',
      'step_practice-finding_1',
    ]);
    expect(result.adaptation!.previousStepTitle).toBe('');
  });

  it('works on an empty plan', () => {
    const result = adaptPlan({
      steps: [],
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.steps).toHaveLength(2);
  });

  it('falls back to a neutral topic name when the name is unknown', () => {
    const result = adaptPlan({
      steps: [],
      findings: [finding],
      mastery: weakMastery,
      topicNames: new Map(),
      now: NOW,
      idFactory,
    });

    expect(result.steps[0]!.title).toBe('Review: this topic');
  });
});

describe('adaptPlan — guards', () => {
  it('does nothing when there are no findings', () => {
    const steps = [step({ id: 'a', orderIndex: 0 })];

    const result = adaptPlan({
      steps,
      findings: [],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(false);
    expect(result.adaptation).toBeNull();
    expect(result.steps).toBe(steps);
  });

  it('does not adapt when the topic is not needs_attention', () => {
    const result = adaptPlan({
      steps: [step({ id: 'a', orderIndex: 0 })],
      findings: [finding],
      mastery: strongMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(false);
  });

  it('never adapts for a dismissed finding', () => {
    const result = adaptPlan({
      steps: [step({ id: 'a', orderIndex: 0 })],
      findings: [{ ...finding, status: 'dismissed' }],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(false);
  });

  it('never adapts for a resolved finding', () => {
    const result = adaptPlan({
      steps: [step({ id: 'a', orderIndex: 0 })],
      findings: [{ ...finding, status: 'resolved' }],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(false);
  });

  it('allows at most one live adaptation per topic', () => {
    const alreadyAdapted = [
      step({
        id: 'existing_review',
        orderIndex: 0,
        kind: 'review',
        topicId: 'topic_conditionals',
        insertedByAdaptation: true,
        status: 'pending',
      }),
      step({ id: 'a', orderIndex: 1 }),
    ];

    const result = adaptPlan({
      steps: alreadyAdapted,
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(false);
  });

  it('allows a new adaptation once the previous one is completed', () => {
    const steps = [
      step({
        id: 'old_review',
        orderIndex: 0,
        kind: 'review',
        topicId: 'topic_conditionals',
        insertedByAdaptation: true,
        status: 'completed',
      }),
      step({ id: 'a', orderIndex: 1 }),
    ];

    const result = adaptPlan({
      steps,
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.adapted).toBe(true);
  });

  it('adapts only once per call even with several eligible findings', () => {
    const second: ActiveFindingInput = {
      ...finding,
      id: 'finding_2',
      topicId: 'topic_loops',
      tag: 'off_by_one',
    };

    const mastery = computeMasteryByTopic(
      ['topic_conditionals', 'topic_loops'],
      [
        ...sequence([false, false, false], { topicId: 'topic_conditionals' }),
        ...sequence([false, false, false], { topicId: 'topic_loops' }),
      ],
    );

    const result = adaptPlan({
      steps: [step({ id: 'a', orderIndex: 0 })],
      findings: [finding, second],
      mastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    expect(result.steps.filter((s) => s.insertedByAdaptation)).toHaveLength(2);
    expect(result.adaptation!.triggeredByFindingId).toBe('finding_1');
  });
});

describe('revertAdaptation — preserving human control', () => {
  it('removes pending inserted steps and restores the original order', () => {
    const steps = [
      step({ id: 'a', orderIndex: 0, status: 'completed' }),
      step({ id: 'ins_1', orderIndex: 1, insertedByAdaptation: true, status: 'pending' }),
      step({ id: 'ins_2', orderIndex: 2, insertedByAdaptation: true, status: 'pending' }),
      step({ id: 'b', orderIndex: 3, status: 'pending' }),
    ];

    const result = revertAdaptation(steps);

    expect(result.steps.map((s) => s.id)).toEqual(['a', 'b']);
    expect(result.steps.map((s) => s.orderIndex)).toEqual([0, 1]);
    expect(result.removedCount).toBe(2);
  });

  it('keeps inserted steps the student already completed', () => {
    const steps = [
      step({ id: 'ins_done', orderIndex: 0, insertedByAdaptation: true, status: 'completed' }),
      step({ id: 'ins_todo', orderIndex: 1, insertedByAdaptation: true, status: 'pending' }),
      step({ id: 'b', orderIndex: 2 }),
    ];

    const result = revertAdaptation(steps);

    expect(result.steps.map((s) => s.id)).toEqual(['ins_done', 'b']);
    expect(result.removedCount).toBe(1);
  });

  it('removes an active inserted step too', () => {
    const steps = [
      step({ id: 'ins', orderIndex: 0, insertedByAdaptation: true, status: 'active' }),
      step({ id: 'b', orderIndex: 1 }),
    ];

    expect(revertAdaptation(steps).steps.map((s) => s.id)).toEqual(['b']);
  });

  it('is a no-op on a plan that was never adapted', () => {
    const steps = [step({ id: 'a', orderIndex: 0 }), step({ id: 'b', orderIndex: 1 })];

    const result = revertAdaptation(steps);

    expect(result.removedCount).toBe(0);
    expect(result.steps.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('round-trips: adapt then revert returns the original step ids', () => {
    const original = [
      step({ id: 'a', orderIndex: 0, status: 'completed' }),
      step({ id: 'b', orderIndex: 1 }),
    ];

    const adapted = adaptPlan({
      steps: original,
      findings: [finding],
      mastery: weakMastery,
      topicNames,
      now: NOW,
      idFactory,
    });

    const reverted = revertAdaptation(adapted.steps);

    expect(reverted.steps.map((s) => s.id)).toEqual(original.map((s) => s.id));
  });
});

describe('buildAdaptationReason', () => {
  it('phrases the reason in the student\'s terms', () => {
    expect(buildAdaptationReason(finding)).toBe(
      'Confusing assignment with comparison in 3 of your last 5 answers',
    );
  });
});
