import type { LessonStatus, PlanModule, PlanStep } from '@educlm/contracts';

/**
 * The plan as modules: one per topic, in course order, each holding its own
 * steps in a fixed order.
 *
 * The flat step list stays exactly as it is — it is what the adaptation engine
 * reorders and what `currentStepId` points into — so this is a second view of
 * the same rows rather than a second source of truth. Grouping server-side
 * keeps the template identical wherever the plan is rendered.
 */

export interface ModuleTopic {
  id: string;
  name: string;
  summary: string;
  orderIndex: number;
  sourcePages: number[];
  objectives: string[];
  keyTerms: string[];
  lessonStatus: LessonStatus;
}

/** Read first, then practise, then anything the adaptation engine added. */
const KIND_ORDER: Record<PlanStep['kind'], number> = {
  read: 0,
  practice: 1,
  review: 2,
  advance: 3,
};

function orderSteps(steps: PlanStep[]): PlanStep[] {
  return [...steps].sort((a, b) => {
    // An inserted step follows the original of its kind, whatever the plan
    // order says: within a module the template order is what a student reads.
    if (a.insertedByAdaptation !== b.insertedByAdaptation) {
      return a.insertedByAdaptation ? 1 : -1;
    }
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.orderIndex - b.orderIndex;
  });
}

/**
 * A module's own progress, on the same rule as every other figure: a skipped
 * step is a decision, not outstanding work, so it leaves both sides.
 */
function summarise(steps: PlanStep[]) {
  const outstanding = steps.filter((step) => step.status !== 'skipped');
  const completed = outstanding.filter((step) => step.status === 'completed').length;

  return {
    totalSteps: outstanding.length,
    completedSteps: completed,
    estimatedMinutes: outstanding
      .filter((step) => step.status !== 'completed')
      .reduce((total, step) => total + step.estimatedMinutes, 0),
    status:
      outstanding.length > 0 && completed === outstanding.length
        ? ('completed' as const)
        : completed > 0 || steps.some((step) => step.status === 'active')
          ? ('in_progress' as const)
          : ('pending' as const),
  };
}

export function buildPlanModules(steps: PlanStep[], topics: ModuleTopic[]): PlanModule[] {
  const byTopic = new Map<string, PlanStep[]>();
  const untopiced: PlanStep[] = [];

  for (const step of steps) {
    if (!step.topicId) {
      untopiced.push(step);
      continue;
    }
    const list = byTopic.get(step.topicId);
    if (list) list.push(step);
    else byTopic.set(step.topicId, [step]);
  }

  const modules: PlanModule[] = [...topics]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .flatMap((topic) => {
      const steps = byTopic.get(topic.id);
      if (!steps || steps.length === 0) return [];

      return [
        {
          topicId: topic.id,
          topicName: topic.name,
          summary: topic.summary,
          sourcePages: topic.sourcePages,
          objectives: topic.objectives,
          keyTerms: topic.keyTerms,
          lessonStatus: topic.lessonStatus,
          stepIds: orderSteps(steps).map((step) => step.id),
          ...summarise(steps),
        },
      ];
    });

  // Steps whose topic was removed, or that never had one, still belong to the
  // plan — they go last rather than disappearing from the modules view.
  if (untopiced.length > 0) {
    modules.push({
      topicId: null,
      topicName: 'General',
      summary: 'Steps that are not tied to one topic.',
      sourcePages: [],
      objectives: [],
      keyTerms: [],
      lessonStatus: 'ready',
      stepIds: orderSteps(untopiced).map((step) => step.id),
      ...summarise(untopiced),
    });
  }

  return modules;
}
