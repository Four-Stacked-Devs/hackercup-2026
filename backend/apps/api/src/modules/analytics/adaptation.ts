import type {
  ActiveFindingInput,
  AdaptationResult,
  IdFactory,
  MasteryResult,
  PlanStepInput,
} from './types.js';

/** Questions in an adaptation-inserted focused set. */
export const FOCUSED_SET_SIZE = 5;

const REVIEW_MINUTES = 6;
const PRACTICE_MINUTES = 8;

function reindex(steps: PlanStepInput[]): PlanStepInput[] {
  return steps.map((step, orderIndex) => ({ ...step, orderIndex }));
}

/** "Confusing assignment with comparison in 3 of your last 5 answers" */
export function buildAdaptationReason(finding: ActiveFindingInput): string {
  return `${finding.label} in ${finding.occurrences} of your last ${finding.windowSize} answers`;
}

/**
 * Insert a review + focused-practice pair ahead of the next pending step, for
 * the highest-ranked topic that is both struggling and has an active finding.
 *
 * Rule (section 10):
 *   if a topic has an ACTIVE finding AND band == 'needs_attention'
 *
 * Guards:
 *   - at most one adaptation per topic active at a time
 *   - never insert for a finding the student dismissed (only `active` is eligible)
 *   - at most one adaptation per call
 *
 * The adaptation is never silent: every inserted step is flagged
 * `insertedByAdaptation`, and the returned record explains what changed and why.
 */
export function adaptPlan(params: {
  steps: PlanStepInput[];
  /** Should already be ranked by `rankFindings`. Non-active entries are ignored. */
  findings: ActiveFindingInput[];
  mastery: MasteryResult[];
  topicNames: Map<string, string>;
  now: Date;
  idFactory: IdFactory;
}): AdaptationResult {
  const { steps, findings, mastery, topicNames, now, idFactory } = params;

  const bandByTopic = new Map(mastery.map((m) => [m.topicId, m.band]));

  const topicsWithLiveAdaptation = new Set(
    steps
      .filter(
        (s) =>
          s.insertedByAdaptation &&
          s.topicId !== null &&
          (s.status === 'pending' || s.status === 'active'),
      )
      .map((s) => s.topicId as string),
  );

  const eligible = findings.find(
    (f) =>
      f.status === 'active' &&
      bandByTopic.get(f.topicId) === 'needs_attention' &&
      !topicsWithLiveAdaptation.has(f.topicId),
  );

  if (!eligible) {
    return { steps, adapted: false, adaptation: null };
  }

  const topicName = topicNames.get(eligible.topicId) ?? 'this topic';

  const reviewStep: PlanStepInput = {
    id: idFactory(`review-${eligible.id}`),
    kind: 'review',
    title: `Review: ${topicName}`,
    description: `A focused re-read of ${topicName}, aimed at ${eligible.label.toLowerCase()}.`,
    topicId: eligible.topicId,
    targetType: 'lesson',
    targetId: eligible.topicId,
    targetPage: null,
    estimatedMinutes: REVIEW_MINUTES,
    status: 'pending',
    orderIndex: 0, // reassigned by reindex
    insertedByAdaptation: true,
  };

  const practiceStep: PlanStepInput = {
    id: idFactory(`practice-${eligible.id}`),
    kind: 'practice',
    title: `Focused practice: ${topicName}`,
    description: `${FOCUSED_SET_SIZE} questions on ${topicName}, weighted toward the ones that trip up ${eligible.label.toLowerCase()}.`,
    topicId: eligible.topicId,
    targetType: 'practice_set',
    targetId: null,
    targetPage: null,
    estimatedMinutes: PRACTICE_MINUTES,
    status: 'pending',
    orderIndex: 0,
    insertedByAdaptation: true,
  };

  const targetIndex = steps.findIndex((s) => s.status === 'pending');
  const insertAt = targetIndex === -1 ? steps.length : targetIndex;
  const target = targetIndex === -1 ? null : steps[targetIndex]!;

  const nextSteps = reindex([
    ...steps.slice(0, insertAt),
    reviewStep,
    practiceStep,
    ...steps.slice(insertAt),
  ]);

  return {
    steps: nextSteps,
    adapted: true,
    adaptation: {
      at: now,
      reason: buildAdaptationReason(eligible),
      triggeredByFindingId: eligible.id,
      previousStepTitle: target?.title ?? '',
      newStepTitle: reviewStep.title,
    },
  };
}

/**
 * Undo the last adaptation — the student rejects the change and returns to the
 * original path. This is the "preserve human control" principle in code.
 *
 * Steps the student already COMPLETED are kept: they did that work, and
 * deleting it would erase real history from their progress view. Only pending
 * and active inserted steps are removed.
 */
export function revertAdaptation(steps: PlanStepInput[]): {
  steps: PlanStepInput[];
  removedCount: number;
} {
  const kept = steps.filter(
    (s) => !(s.insertedByAdaptation && (s.status === 'pending' || s.status === 'active')),
  );

  return {
    steps: reindex(kept),
    removedCount: steps.length - kept.length,
  };
}
