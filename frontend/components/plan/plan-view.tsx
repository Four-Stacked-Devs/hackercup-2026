'use client';

import { useRouter } from 'next/navigation';
import type { LearningPlan, PlanStep } from '@educlm/contracts';
import { Card, CardHeader, SectionHeading } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { Chip, StatusLabel } from '@/components/ui/chip';
import { ProgressRing } from '@/components/ui/charts';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { EduSays } from '@/components/brand/edu-mascot';
import { CheckIcon } from '@/components/ui/icons';
import { STEP_KIND_LABEL, minutesLabel } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  useCompletePlanStep,
  usePlan,
  useProgressOverview,
  useRevertAdaptation,
  useSkipPlanStep,
} from '@/lib/hooks/use-progress';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';

/**
 * The plan workspace: the sequence as a table, what it adds up to beside it,
 * and one recommended action at the end.
 */
export function PlanView({
  materialId,
  materialTitle,
  compact = false,
}: {
  materialId: string;
  materialTitle: string;
  /** Panel mode: one column, list instead of table. */
  compact?: boolean;
}) {
  const query = usePlan(materialId);

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const plan = query.data;
  const done = plan.steps.filter((step) => step.status === 'completed').length;
  const remaining = plan.steps
    .filter((step) => step.status !== 'completed' && step.status !== 'skipped')
    .reduce((total, step) => total + step.estimatedMinutes, 0);

  const current =
    plan.steps.find((step) => step.id === plan.currentStepId) ??
    plan.steps.find((step) => step.status === 'active') ??
    plan.steps.find((step) => step.status === 'pending');

  return (
    <div className="space-y-4">
      <Card>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Goal" value={materialTitle} />
          <Stat label="Time left" value={minutesLabel(remaining)} />
          <Stat label="Steps done" value={`${done} of ${plan.steps.length}`} />
          <Stat
            label="Deadline"
            value={<span className="text-ink-muted">Not tracked in this build</span>}
          />
        </dl>
      </Card>

      {plan.lastAdaptation ? <AdaptationBanner materialId={materialId} plan={plan} /> : null}

      <div className={cn('grid gap-4', compact ? '' : 'lg:grid-cols-[1fr_17rem]')}>
        <Card>
          <CardHeader
            title="Study plan overview"
            description={`${done} of ${plan.steps.length} steps done`}
            action={
              <span
                className="text-xs text-ink-subtle"
                title="Reordering is not in this build — the order is decided by the server."
              >
                Order set by EducLM
              </span>
            }
          />

          {/* A table is a desktop shape. On a phone the same rows stack — the
              mobile layout is its own design, not a shrunken table. */}
          <ol className={cn('m-0 list-none divide-y divide-line', !compact && 'lg:hidden')}>
            {plan.steps.map((step, index) => (
              <PlanStepRow
                key={step.id}
                step={step}
                index={index}
                materialId={materialId}
                isCurrent={step.id === current?.id}
              />
            ))}
          </ol>

          {!compact ? (
            <div className="hidden lg:block">
              <PlanTable plan={plan} materialId={materialId} currentId={current?.id ?? null} />
            </div>
          ) : null}
        </Card>

        {!compact ? (
          <div className="space-y-4">
            <Card>
              <SectionHeading title="All progress" level={3} />
              <div className="flex justify-center">
                <ProgressRing
                  value={plan.steps.length === 0 ? 0 : done / plan.steps.length}
                  caption="of the plan"
                  size={124}
                />
              </div>
            </Card>

            <FocusAreas materialId={materialId} />

            {current ? (
              <Card className="border-lime">
                <SectionHeading title="Recommended next step" level={3} />
                <p className="text-sm font-semibold text-ink">{current.title}</p>
                <p className="mt-1 text-xs text-ink-muted">{current.description}</p>
                <div className="mt-3">
                  <StepAction step={current} materialId={materialId} primary />
                </div>
              </Card>
            ) : null}
          </div>
        ) : current ? (
          <Card className="border-lime">
            <SectionHeading title="Recommended next step" level={3} />
            <p className="text-sm font-semibold text-ink">{current.title}</p>
            <div className="mt-3">
              <StepAction step={current} materialId={materialId} primary />
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-display text-sm font-bold text-ink">{value}</dd>
    </div>
  );
}

/** The desktop table from the mockup: number, step, time, type, status. */
function PlanTable({
  plan,
  materialId,
  currentId,
}: {
  plan: LearningPlan;
  materialId: string;
  currentId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            <th scope="col" className="w-8 py-2 pr-2 font-medium">
              #
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Step
            </th>
            <th scope="col" className="w-24 py-2 pr-3 font-medium">
              Est. time
            </th>
            <th scope="col" className="w-24 py-2 pr-3 font-medium">
              Type
            </th>
            <th scope="col" className="w-32 py-2 pr-3 font-medium">
              Status
            </th>
            <th scope="col" className="w-52 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.steps.map((step, index) => (
            <tr
              key={step.id}
              className={cn(
                'border-b border-line align-top last:border-0',
                step.id === currentId && 'bg-lime-soft',
                step.status === 'skipped' && 'opacity-60',
              )}
            >
              <td className="py-2.5 pr-2 text-xs text-ink-muted tabular-nums">{index + 1}</td>
              <td className="py-2.5 pr-3">
                <span className="block font-medium text-ink">{step.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {step.insertedByAdaptation ? <Chip tone="lime">Added by EDU</Chip> : null}
                  {step.id === currentId ? <Chip tone="ink">Next up</Chip> : null}
                </span>
              </td>
              <td className="py-2.5 pr-3 text-xs text-ink-muted tabular-nums">
                {step.estimatedMinutes} min
              </td>
              <td className="py-2.5 pr-3 text-xs text-ink-muted">{STEP_KIND_LABEL[step.kind]}</td>
              <td className="py-2.5 pr-3">
                <StatusLabel status={step.status} />
              </td>
              <td className="py-2.5">
                {step.status === 'completed' || step.status === 'skipped' ? null : (
                  <StepRowActions step={step} materialId={materialId} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepRowActions({ step, materialId }: { step: PlanStep; materialId: string }) {
  const complete = useCompletePlanStep(materialId);
  const skip = useSkipPlanStep(materialId);

  return (
    <span className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
      <StepAction step={step} materialId={materialId} />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => complete.mutate(step.id)}
        disabled={complete.isPending}
      >
        Done
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-ink-muted"
        onClick={() => skip.mutate(step.id)}
        disabled={skip.isPending}
      >
        Skip
      </Button>
    </span>
  );
}

function AdaptationBanner({ materialId, plan }: { materialId: string; plan: LearningPlan }) {
  const revert = useRevertAdaptation(materialId);
  const adaptation = plan.lastAdaptation!;

  return (
    <EduSays
      action={
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 bg-surface"
          onClick={() => revert.mutate()}
          disabled={revert.isPending}
        >
          {revert.isPending ? 'Restoring…' : 'Undo'}
        </Button>
      }
    >
      I moved <strong>{adaptation.previousStepTitle}</strong> back and put{' '}
      <strong>{adaptation.newStepTitle}</strong> first, because {adaptation.reason.toLowerCase()}.
      {revert.isError ? <ErrorState className="mt-2" error={revert.error} /> : null}
    </EduSays>
  );
}

/** The topics the plan is currently aimed at, from real mastery bands. */
function FocusAreas({ materialId }: { materialId: string }) {
  const progress = useProgressOverview(materialId);

  const focus = (progress.data?.masteryByTopic ?? []).filter(
    (topic) => topic.band === 'needs_attention' || topic.band === 'developing',
  );

  return (
    <Card>
      <SectionHeading title="Focus areas" level={3} />
      {focus.length === 0 ? (
        <p className="text-xs text-ink-muted">
          Nothing is flagged right now. Practise a topic and any weak spot appears here.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5">
          {focus.map((topic) => (
            <li key={topic.topicId}>
              <Chip tone={topic.band === 'needs_attention' ? 'attention' : 'developing'}>
                {topic.topicName}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlanStepRow({
  step,
  index,
  materialId,
  isCurrent,
}: {
  step: PlanStep;
  index: number;
  materialId: string;
  isCurrent: boolean;
}) {
  const complete = useCompletePlanStep(materialId);
  const skip = useSkipPlanStep(materialId);

  const done = step.status === 'completed';
  const skipped = step.status === 'skipped';

  return (
    <li className={cn('py-2.5 first:pt-0 last:pb-0', skipped && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
            done ? 'bg-lime text-lime-ink' : 'bg-surface-sunken text-ink-muted',
          )}
        >
          {done ? <CheckIcon width="0.85em" height="0.85em" /> : index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{step.title}</span>
          <span className="text-xs text-ink-muted">
            {step.estimatedMinutes} min · {STEP_KIND_LABEL[step.kind]}
          </span>
        </span>

        {step.insertedByAdaptation ? <Chip tone="lime">Added by EDU</Chip> : null}
        <StatusLabel status={step.status} />
      </div>

      {!done && !skipped ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-8.5">
          <StepAction step={step} materialId={materialId} />
          {isCurrent ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => complete.mutate(step.id)}
                disabled={complete.isPending}
              >
                Mark as done
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-ink-muted"
                onClick={() => skip.mutate(step.id)}
                disabled={skip.isPending}
              >
                Skip
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {complete.isError || skip.isError ? (
        <ErrorState className="mt-2" error={complete.error ?? skip.error} />
      ) : null}
    </li>
  );
}

function StepAction({
  step,
  materialId,
  primary = false,
}: {
  step: PlanStep;
  materialId: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const createSet = useCreatePracticeSet();

  if (step.kind === 'practice') {
    const start = () =>
      createSet.mutate(
        {
          materialId,
          kind: 'focused',
          ...(step.topicId ? { topicId: step.topicId } : {}),
          count: 5,
        },
        { onSuccess: (set) => router.push(`/practice/${set.id}`) },
      );

    return (
      <>
        <Button
          variant={primary ? 'primary' : 'outline'}
          size="sm"
          onClick={start}
          disabled={createSet.isPending}
        >
          {createSet.isPending ? 'Building…' : primary ? 'Start next step' : 'Practise'}
        </Button>
        {createSet.isError ? (
          <ErrorState className="mt-2" error={createSet.error} onRetry={start} />
        ) : null}
      </>
    );
  }

  const href =
    step.target?.type === 'lesson' && step.target.id
      ? `/study/${materialId}?topicId=${encodeURIComponent(step.target.id)}`
      : step.target?.type === 'page' && step.target.page
        ? `/study/${materialId}?page=${step.target.page}`
        : `/study/${materialId}`;

  return (
    <ButtonLink variant={primary ? 'primary' : 'outline'} size="sm" href={href}>
      {primary ? 'Start next step' : step.kind === 'review' ? 'Review' : 'Read'}
    </ButtonLink>
  );
}
