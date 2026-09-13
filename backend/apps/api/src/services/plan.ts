import { randomUUID } from 'node:crypto';
import type { LearningPlan } from '@educlm/contracts';
import { db } from '../db/client.js';
import { toLearningPlan } from '../lib/serializers.js';
import { estimateReadMinutes } from '../modules/plan/reading-time.js';
import {
  practiceStepDescription,
  practiceStepTitle,
  readStepDescription,
  readStepTitle,
} from '../modules/plan/template.js';
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
  Topic as TopicRow,
} from '../generated/prisma/client.js';
import { buildTopicTemplate } from '../modules/ingestion/topic-template.js';

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

/**
 * Builds in flight, keyed by user and material.
 *
 * The lesson worker prebuilds the owner's plan the moment a material is READY,
 * which is exactly when the student is likely to open it. Both callers passing
 * the "no steps yet" check would each write a full set of steps; sharing one
 * promise makes the second wait for the first instead. In process, like the
 * job queues.
 */
/** Questions a practice step asks for; matches the client's `count`. */
const PRACTICE_SET_SIZE = 5;

const building = new Map<string, ReturnType<typeof buildPlanIfMissing>>();

export function ensurePlan(userId: string, materialId: string) {
  const key = `${userId}:${materialId}`;
  const inFlight = building.get(key);
  if (inFlight) return inFlight;

  const build = buildPlanIfMissing(userId, materialId).finally(() => building.delete(key));
  building.set(key, build);
  return build;
}

/**
 * Build the starting plan: read then practise, topic by topic, in course order.
 *
 * A plan with no steps is treated as one that was never built, not as an empty
 * plan the student owns. Nothing stops this being reached while a material is
 * still being prepared — it has no topics yet — and returning that row unchanged
 * left the student with a permanently empty plan that ingestion never refilled.
 * Backfilling is safe to repeat: steps are only ever created for a plan that has
 * none.
 */
async function buildPlanIfMissing(userId: string, materialId: string) {
  const existing = await db().learningPlan.findUnique({
    where: { userId_materialId: { userId, materialId } },
    include: { steps: true },
  });
  if (existing && existing.steps.length > 0) return existing;

  const material = await db().material.findUnique({ where: { id: materialId } });

  // Topics appear partway through ingestion, but the lessons that reading times
  // are estimated from only exist once it finishes. Planning early also raced
  // the request that came after READY into building a second set of steps.
  const topics =
    material?.status === 'READY'
      ? await db().topic.findMany({ where: { materialId }, orderBy: { orderIndex: 'asc' } })
      : [];

  // Still nothing to plan against. Leave the row as it is rather than writing an
  // empty plan we would have to recognise and repair later.
  if (existing && topics.length === 0) return existing;

  const lessons = await db().lessonSection.findMany({
    where: { topicId: { in: topics.map((t) => t.id) } },
    select: { topicId: true, bodyMarkdown: true },
  });
  const lessonText = new Map<string, string>();
  for (const section of lessons) {
    const sofar = lessonText.get(section.topicId) ?? '';
    lessonText.set(section.topicId, `${sofar} ${section.bodyMarkdown}`);
  }

  const current = await db().learningPlan.findUnique({
    where: { userId_materialId: { userId, materialId } },
    include: { steps: true },
  });
  if (current && current.steps.length > 0) return current;

  const plan =
    current ??
    (await db().learningPlan.create({
      data: { userId, materialId },
    }));

  // One insert for every step: created one by one, a ten-topic plan was twenty
  // sequential round trips. Ids are minted here so the first step is known
  // without reading the rows back.
  const steps = topics.flatMap((topic, index) => [
    {
      id: randomUUID(),
      planId: plan.id,
      kind: 'READ' as const,
      title: readStepTitle(topic),
      description: readStepDescription(topic),
      topicId: topic.id,
      targetType: 'lesson',
      targetId: topic.id,
      estimatedMinutes: estimateReadMinutes(
        lessonText.get(topic.id) ?? '',
        topic.sourcePages.length,
      ),
      status: index === 0 ? ('ACTIVE' as const) : ('PENDING' as const),
      orderIndex: index * 2,
    },
    {
      id: randomUUID(),
      planId: plan.id,
      kind: 'PRACTICE' as const,
      title: practiceStepTitle(topic),
      description: practiceStepDescription(topic, PRACTICE_SET_SIZE),
      topicId: topic.id,
      targetType: 'practice_set',
      estimatedMinutes: 6,
      status: 'PENDING' as const,
      orderIndex: index * 2 + 1,
    },
  ]);

  if (steps.length > 0) {
    await db().planStep.createMany({ data: steps });
    await db().learningPlan.update({
      where: { id: plan.id },
      data: { currentStepId: steps[0]!.id },
    });
  }

  return db().learningPlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { steps: true },
  });
}

export async function getPlan(userId: string, materialId: string): Promise<LearningPlan> {
  const plan = await ensurePlan(userId, materialId);
  const [steps, topics] = await Promise.all([
    db().planStep.findMany({ where: { planId: plan.id }, orderBy: { orderIndex: 'asc' } }),
    db().topic.findMany({ where: { materialId }, orderBy: { orderIndex: 'asc' } }),
  ]);
  return toLearningPlan(plan, steps, await backfillTopicTemplates(materialId, topics));
}

/**
 * Give topics prepared before they carried outcomes and key terms their
 * template, from their own passages — no model call — the first time their plan
 * is read. Without it every older material rendered its modules half empty.
 * One batched write, and only for topics that still need it.
 */
async function backfillTopicTemplates(materialId: string, topics: TopicRow[]): Promise<TopicRow[]> {
  const bare = topics.filter((topic) => topic.objectives.length === 0);
  if (bare.length === 0) return topics;

  const chunks = await db().chunk.findMany({
    where: { materialId },
    select: { page: true, content: true },
  });

  const filled = new Map(
    bare.map((topic) => {
      const pages = new Set(topic.sourcePages);
      return [
        topic.id,
        buildTopicTemplate({
          name: topic.name,
          keyTerms: topic.keyTerms,
          passages: chunks.filter((chunk) => pages.has(chunk.page)),
        }),
      ] as const;
    }),
  );

  const values = bare.map((_, i) => `($${i * 3 + 1}::text, $${i * 3 + 2}::text, $${i * 3 + 3}::text)`);
  await db().$executeRawUnsafe(
    `UPDATE "Topic" AS t
       SET objectives = ARRAY(SELECT jsonb_array_elements_text(v.objectives::jsonb)),
           "keyTerms" = ARRAY(SELECT jsonb_array_elements_text(v.terms::jsonb))
      FROM (VALUES ${values.join(', ')}) AS v(id, objectives, terms)
     WHERE t.id = v.id`,
    ...bare.flatMap((topic) => {
      const template = filled.get(topic.id)!;
      return [topic.id, JSON.stringify(template.objectives), JSON.stringify(template.keyTerms)];
    }),
  );

  return topics.map((topic) => ({ ...topic, ...(filled.get(topic.id) ?? {}) }));
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
