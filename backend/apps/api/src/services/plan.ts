import { randomUUID } from 'node:crypto';
import type { LearningPlan } from '@educlm/contracts';
import { db } from '../db/client.js';
import { toLearningPlan } from '../lib/serializers.js';
import {
  adaptPlan,
  computeMasteryByTopic,
  rankFindings,
  revertAdaptation as revertAdaptationPure,
  type PlanStepInput,
  type ResponseInput,
} from '../modules/analytics/index.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  PlanStep as PlanStepRow,
  PlanStepKind,
  PlanStepStatus,
} from '../generated/prisma/client.js';

/**
 * Learning plan persistence and adaptation.
 *
 * All ordering decisions come from the pure engine in `modules/analytics`;
 * this file only reads rows in and writes rows back.
 */

function toStepInput(row: PlanStepRow): PlanStepInput {
  return {
    id: row.id,
    kind: row.kind.toLowerCase() as PlanStepInput['kind'],
    title: row.title,
    description: row.description,
    topicId: row.topicId,
    targetType: row.targetType as PlanStepInput['targetType'],
    targetId: row.targetId,
    targetPage: row.targetPage,
    estimatedMinutes: row.estimatedMinutes,
    status: row.status.toLowerCase() as PlanStepInput['status'],
    orderIndex: row.orderIndex,
    insertedByAdaptation: row.insertedByAdaptation,
  };
}

/** Build the starting plan: read then practise, topic by topic, in course order. */
export async function ensurePlan(userId: string, materialId: string) {
  const existing = await db().learningPlan.findUnique({
    where: { userId_materialId: { userId, materialId } },
    include: { steps: true },
  });
  if (existing) return existing;

  const topics = await db().topic.findMany({
    where: { materialId },
    orderBy: { orderIndex: 'asc' },
  });

  const plan = await db().learningPlan.create({
    data: { userId, materialId },
  });

  let orderIndex = 0;
  for (const topic of topics) {
    await db().planStep.create({
      data: {
        planId: plan.id,
        kind: 'READ',
        title: `Read: ${topic.name}`,
        description: topic.summary,
        topicId: topic.id,
        targetType: 'lesson',
        targetId: topic.id,
        estimatedMinutes: 8,
        status: orderIndex === 0 ? 'ACTIVE' : 'PENDING',
        orderIndex: orderIndex++,
      },
    });

    await db().planStep.create({
      data: {
        planId: plan.id,
        kind: 'PRACTICE',
        title: `Practise: ${topic.name}`,
        description: `A short set of questions on ${topic.name}.`,
        topicId: topic.id,
        targetType: 'practice_set',
        estimatedMinutes: 6,
        status: 'PENDING',
        orderIndex: orderIndex++,
      },
    });
  }

  const first = await db().planStep.findFirst({
    where: { planId: plan.id },
    orderBy: { orderIndex: 'asc' },
  });

  if (first) {
    await db().learningPlan.update({
      where: { id: plan.id },
      data: { currentStepId: first.id },
    });
  }

  return db().learningPlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { steps: true },
  });
}

export async function getPlan(userId: string, materialId: string): Promise<LearningPlan> {
  const plan = await ensurePlan(userId, materialId);
  const steps = await db().planStep.findMany({
    where: { planId: plan.id },
    orderBy: { orderIndex: 'asc' },
  });
  return toLearningPlan(plan, steps);
}

/**
 * Run the adaptation rules and persist the result.
 * Returns whether anything changed, so callers can report `planUpdated`.
 */
export async function applyAdaptation(params: {
  userId: string;
  materialId: string;
  responses: ResponseInput[];
  now: Date;
}): Promise<boolean> {
  const { userId, materialId, responses, now } = params;

  const plan = await ensurePlan(userId, materialId);
  const topics = await db().topic.findMany({ where: { materialId } });
  const topicIds = topics.map((t) => t.id);

  const findingRows = await db().misconceptionFinding.findMany({
    where: { userId, topicId: { in: topicIds }, status: 'ACTIVE' },
  });
  if (findingRows.length === 0) return false;

  const mastery = computeMasteryByTopic(topicIds, responses);

  const ranked = rankFindings(
    findingRows.map((row) => ({
      topicId: row.topicId,
      tag: row.tag,
      occurrences: row.occurrences,
      windowSize: row.windowSize,
      evidenceResponseIds: row.evidenceResponseIds,
      lastOccurredAt: row.detectedAt,
    })),
    mastery,
  );

  const rowByKey = new Map(findingRows.map((row) => [`${row.topicId}:${row.tag}`, row]));

  const findings = ranked.flatMap((r) => {
    const row = rowByKey.get(`${r.topicId}:${r.tag}`);
    return row
      ? [
          {
            id: row.id,
            topicId: row.topicId,
            tag: row.tag,
            label: row.label,
            occurrences: row.occurrences,
            windowSize: row.windowSize,
            status: 'active' as const,
          },
        ]
      : [];
  });

  const currentSteps = await db().planStep.findMany({
    where: { planId: plan.id },
    orderBy: { orderIndex: 'asc' },
  });

  const result = adaptPlan({
    steps: currentSteps.map(toStepInput),
    findings,
    mastery,
    topicNames: new Map(topics.map((t) => [t.id, t.name])),
    now,
    idFactory: () => randomUUID(),
  });

  if (!result.adapted) return false;

  const existingIds = new Set(currentSteps.map((s) => s.id));

  for (const step of result.steps) {
    if (existingIds.has(step.id)) {
      await db().planStep.update({
        where: { id: step.id },
        data: { orderIndex: step.orderIndex },
      });
    } else {
      await db().planStep.create({
        data: {
          id: step.id,
          planId: plan.id,
          kind: step.kind.toUpperCase() as PlanStepKind,
          title: step.title,
          description: step.description,
          topicId: step.topicId,
          targetType: step.targetType,
          targetId: step.targetId,
          targetPage: step.targetPage,
          estimatedMinutes: step.estimatedMinutes,
          status: step.status.toUpperCase() as PlanStepStatus,
          orderIndex: step.orderIndex,
          insertedByAdaptation: step.insertedByAdaptation,
        },
      });
    }
  }

  await db().learningPlan.update({
    where: { id: plan.id },
    data: {
      lastAdaptation: {
        at: result.adaptation!.at.toISOString(),
        reason: result.adaptation!.reason,
        triggeredByFindingId: result.adaptation!.triggeredByFindingId,
        previousStepTitle: result.adaptation!.previousStepTitle,
        newStepTitle: result.adaptation!.newStepTitle,
      },
    },
  });

  return true;
}

async function setStepStatus(
  userId: string,
  stepId: string,
  status: PlanStepStatus,
): Promise<LearningPlan | null> {
  const step = await db().planStep.findFirst({
    where: { id: stepId, plan: { userId } },
    include: { plan: true },
  });
  if (!step) return null;

  await db().planStep.update({ where: { id: stepId }, data: { status } });

  // Advance to the next step that still needs doing.
  const next = await db().planStep.findFirst({
    where: { planId: step.planId, status: 'PENDING', orderIndex: { gt: step.orderIndex } },
    orderBy: { orderIndex: 'asc' },
  });

  if (next) {
    await db().planStep.update({ where: { id: next.id }, data: { status: 'ACTIVE' } });
  }

  await db().learningPlan.update({
    where: { id: step.planId },
    data: { currentStepId: next?.id ?? null },
  });

  return getPlan(userId, step.plan.materialId);
}

export const completeStep = (userId: string, stepId: string) =>
  setStepStatus(userId, stepId, 'COMPLETED');

export const skipStep = (userId: string, stepId: string) =>
  setStepStatus(userId, stepId, 'SKIPPED');

/**
 * The student rejects an adaptation and returns to the original path.
 * Steps they already completed are kept — that work really happened.
 */
export async function revertAdaptation(
  userId: string,
  materialId: string,
): Promise<LearningPlan> {
  const plan = await ensurePlan(userId, materialId);

  const currentSteps = await db().planStep.findMany({
    where: { planId: plan.id },
    orderBy: { orderIndex: 'asc' },
  });

  const result = revertAdaptationPure(currentSteps.map(toStepInput));
  const keptIds = new Set(result.steps.map((s) => s.id));

  await db().planStep.deleteMany({
    where: { planId: plan.id, id: { notIn: [...keptIds] } },
  });

  for (const step of result.steps) {
    await db().planStep.update({
      where: { id: step.id },
      data: { orderIndex: step.orderIndex },
    });
  }

  await db().learningPlan.update({
    where: { id: plan.id },
    // Prisma requires DbNull (SQL NULL) rather than `null` on a nullable Json column.
    data: { lastAdaptation: Prisma.DbNull },
  });

  return getPlan(userId, materialId);
}
