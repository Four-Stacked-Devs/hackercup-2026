'use client';

import { useRouter } from 'next/navigation';
import type { LearningPlan, PlanStep } from '@educlm/contracts';
import { Card, SectionHeading } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ProgressRing } from '@/components/ui/charts';
import { ErrorState, Skeleton, SkeletonCard } from '@/components/ui/states';
import { EduSays } from '@/components/brand/edu-mascot';
import { minutesLabel, planProgress } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePlan, useProgressOverview, useRevertAdaptation } from '@/lib/hooks/use-progress';
import { PlanModuleCard } from './plan-module';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';

/**
 * The plan workspace: what it adds up to, the one thing to do next, then every
 * topic as a module built from the same template.
 */
export function PlanView({
  materialId,
  materialTitle,
  compact = false,
}: {
  materialId: string;
  materialTitle: string;
  /** Panel mode: one column, modules collapsed except the current one. */
  compact?: boolean;
}) {
  const query = usePlan(materialId);

  if (query.isPending) return <PlanSkeleton />;

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const plan = query.data;

  // One reading for every figure on this screen — they used to disagree about
  // whether a skipped step still counted. See `planProgress`.
  const { total, completed: done, remainingMinutes: remaining, completion } = planProgress(
    plan.steps,
  );

  const current =
    plan.steps.find((step) => step.id === plan.currentStepId) ??
    plan.steps.find((step) => step.status === 'active') ??
    plan.steps.find((step) => step.status === 'pending');

  const stepById = new Map(plan.steps.map((step) => [step.id, step]));
  const currentModule = plan.modules.find((module) =>
    current ? module.stepIds.includes(current.id) : false,
  );

  // Inside a module the button names its step ("Read", "Practise"); "Start next
  // step" belongs to the pinned card alone, or it appears twice on screen.
  const renderAction = (step: PlanStep, isCurrent: boolean) => (
    <StepAction step={step} materialId={materialId} highlight={isCurrent} />
  );

  return (
    <div className="space-y-4">
      <Card>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Goal" value={`Master ${materialTitle}`} />
          <Stat label="Time left" value={minutesLabel(remaining)} />
          <Stat label="Steps done" value={`${done} of ${total}`} />
          <Stat
            label="Overall progress"
            value={completion === null ? '—' : `${Math.round(completion * 100)}%`}
          />
        </dl>
      </Card>

      {current ? (
        <Card className="border-lime">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-ink-subtle">
                Up next{currentModule ? ` · ${currentModule.topicName}` : ''}
              </p>
              <p className="mt-0.5 font-display text-base font-bold text-ink">{current.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{current.description}</p>
            </div>
            <div className="shrink-0">
              <StepAction step={current} materialId={materialId} primary />
            </div>
          </div>
        </Card>
      ) : plan.steps.length > 0 ? (
        <EduSays>Every step is done or skipped. Practise any topic below to keep it fresh.</EduSays>
      ) : null}

      {plan.lastAdaptation ? <AdaptationBanner materialId={materialId} plan={plan} /> : null}

      <div className={cn('grid gap-4', compact ? '' : 'lg:grid-cols-[1fr_17rem]')}>
        <section aria-label="Study plan modules" className="space-y-3">
          {plan.modules.map((module, index) => (
            <PlanModuleCard
              key={module.topicId ?? 'general'}
              module={module}
              index={index + 1}
              steps={module.stepIds.flatMap((id) => stepById.get(id) ?? [])}
              materialId={materialId}
              currentStepId={current?.id ?? null}
              renderAction={renderAction}
              // The module the student is in stays open; in the full view so do
              // ones already under way. Everything else collapses to its
              // summary line, which keeps a twelve-topic plan scannable.
              defaultOpen={
                module === currentModule || (!compact && module.status === 'in_progress')
              }
            />
          ))}
        </section>

        {!compact ? (
          <div className="space-y-4">
            <Card>
              <SectionHeading title="All progress" level={3} />
              <div className="flex justify-center">
                <ProgressRing value={completion ?? 0} caption="of the plan" size={124} />
              </div>
            </Card>

            <FocusAreas materialId={materialId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Shaped like the modules it stands in for, so nothing jumps on arrival. */
function PlanSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your study plan">
      <SkeletonCard lines={1} />
      <SkeletonCard lines={2} className="border-lime" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
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
          loading={revert.isPending}
          loadingText="Restoring…"
        >
          Undo
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
      {/* "Nothing is flagged" is a finding, not a placeholder. An empty list
          while the request is in flight — or failed — is not the same thing. */}
      {!progress.isSuccess ? (
        <p className="text-xs text-ink-muted">
          {progress.isError
            ? 'Your weak spots could not be read just now.'
            : 'Checking where you are weakest…'}
        </p>
      ) : focus.length === 0 ? (
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

function StepAction({
  step,
  materialId,
  primary = false,
  highlight = primary,
}: {
  step: PlanStep;
  materialId: string;
  /** The pinned "Up next" action: labelled "Start next step". */
  primary?: boolean;
  /** Primary styling with the step's own label. */
  highlight?: boolean;
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
          variant={highlight ? 'primary' : 'outline'}
          size="sm"
          onClick={start}
          loading={createSet.isPending}
          loadingText="Opening…"
        >
          {primary ? 'Start next step' : 'Practise'}
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
    <ButtonLink variant={highlight ? 'primary' : 'outline'} size="sm" href={href}>
      {primary ? 'Start next step' : step.kind === 'review' ? 'Review' : 'Read'}
    </ButtonLink>
  );
}
