'use client';

import { useState } from 'react';
import type { PlanModule, PlanStep } from '@educlm/contracts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ErrorState } from '@/components/ui/states';
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons';
import { minutesLabel, pageLabel, stepLabel } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useCompletePlanStep, useSkipPlanStep } from '@/lib/hooks/use-progress';

/**
 * One topic of the plan, rendered from the same template as every other.
 *
 * The template is the point: header, what you will be able to do, the words
 * this topic uses, then its steps in a fixed order. A student who has read one
 * module knows where to look in all the others — which a flat list of
 * "Read: X / Practise: X" rows with free-text descriptions never gave them.
 */
export function PlanModuleCard({
  module,
  index,
  steps,
  materialId,
  currentStepId,
  renderAction,
  defaultOpen,
}: {
  module: PlanModule;
  /** 1-based position, shown as "Module 3". */
  index: number;
  /** This module's steps, already in template order. */
  steps: PlanStep[];
  materialId: string;
  currentStepId: string | null;
  renderAction: (step: PlanStep, primary: boolean) => React.ReactNode;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const done = module.status === 'completed';
  const bodyId = `module-${module.topicId ?? 'general'}`;

  return (
    <Card className={cn('p-0', done && 'opacity-90')}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left hover:bg-surface-sunken"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
            done ? 'bg-lime text-lime-ink' : 'bg-surface-sunken text-ink-muted',
          )}
        >
          {done ? <CheckIcon width="0.9em" height="0.9em" /> : index}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xs uppercase tracking-wide text-ink-subtle">
            Module {index}
          </span>
          <span className="block font-display text-sm font-bold text-ink">{module.topicName}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            {module.completedSteps} of {module.totalSteps} steps
            {module.estimatedMinutes > 0 ? ` · ${minutesLabel(module.estimatedMinutes)} left` : ''}
            {module.sourcePages.length > 0 ? ` · ${pageLabel(module.sourcePages)}` : ''}
            {module.topicId === null
              ? ''
              : module.lessonStatus === 'ready'
                ? ' · notes ready'
                : module.lessonStatus === 'failed'
                  ? ' · notes from your PDF'
                  : ' · notes being written'}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <ModuleStatus module={module} />
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('text-ink-muted transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>

      {open ? (
        <div id={bodyId} className="border-t border-line px-4 py-3">
          <section>
            <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              You&apos;ll be able to
            </h4>
            {module.objectives.length > 0 ? (
              <ul className="mt-1.5 m-0 list-disc space-y-1 pl-4 text-sm text-ink">
                {module.objectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ul>
            ) : (
              // Older materials were prepared before topics carried outcomes.
              <p className="mt-1.5 text-sm text-ink">{module.summary}</p>
            )}
          </section>

          {module.keyTerms.length > 0 ? (
            <section className="mt-3">
              <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Key terms
              </h4>
              <ul className="mt-1.5 m-0 flex list-none flex-wrap gap-1.5">
                {module.keyTerms.map((term) => (
                  <li key={term}>
                    <Chip tone="neutral">{term}</Chip>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ol className="mt-3 m-0 list-none divide-y divide-line border-t border-line">
            {steps.map((step) => (
              <PlanStepRow
                key={step.id}
                step={step}
                materialId={materialId}
                isCurrent={step.id === currentStepId}
                renderAction={renderAction}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

function ModuleStatus({ module }: { module: PlanModule }) {
  if (module.status === 'completed') return <Chip tone="lime">Done</Chip>;
  if (module.status === 'in_progress') return <Chip tone="ink">In progress</Chip>;
  return <Chip tone="neutral">Not started</Chip>;
}

/** A step of the template: status, its templated label, time, actions. */
function PlanStepRow({
  step,
  materialId,
  isCurrent,
  renderAction,
}: {
  step: PlanStep;
  materialId: string;
  isCurrent: boolean;
  renderAction: (step: PlanStep, primary: boolean) => React.ReactNode;
}) {
  const complete = useCompletePlanStep(materialId);
  const skip = useSkipPlanStep(materialId);

  const done = step.status === 'completed';
  const skipped = step.status === 'skipped';

  return (
    <li className={cn('py-2.5', skipped && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
            done ? 'border-strong bg-strong text-white' : 'border-line-strong text-transparent',
          )}
        >
          <CheckIcon width="0.8em" height="0.8em" />
        </span>

        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm text-ink', done && 'line-through decoration-line')}>
            {stepLabel(step)}
          </span>
          <span className="text-xs text-ink-muted">
            {minutesLabel(step.estimatedMinutes)}
            {skipped ? ' · skipped' : isCurrent ? ' · next up' : ''}
          </span>
        </span>

        {step.insertedByAdaptation ? <Chip tone="lime">Added by EDU</Chip> : null}
      </div>

      {!done && !skipped ? (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-7.5">
          {renderAction(step, isCurrent)}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => complete.mutate(step.id)}
            loading={complete.isPending}
            loadingText="Saving…"
          >
            Mark as done
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-ink-muted"
            onClick={() => skip.mutate(step.id)}
            loading={skip.isPending}
            loadingText="Skipping…"
          >
            Skip
          </Button>
        </div>
      ) : null}

      {complete.isError || skip.isError ? (
        <ErrorState className="mt-2" error={complete.error ?? skip.error} />
      ) : null}
    </li>
  );
}
