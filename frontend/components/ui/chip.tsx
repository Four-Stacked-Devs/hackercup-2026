import type { ReactNode } from 'react';
import type { MasteryBand, PlanStepStatus } from '@educlm/contracts';
import { cn } from '@/lib/cn';
import { MASTERY_LABEL, MASTERY_TONE } from '@/lib/format';

export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ink' | 'lime' | 'attention' | 'strong' | 'developing';
  className?: string;
}) {
  const tones = {
    neutral: 'border-line bg-surface-sunken text-ink-muted',
    ink: 'border-line-strong bg-surface text-ink',
    lime: 'border-lime bg-lime-soft text-ink',
    attention: 'border-attention/40 bg-attention-soft text-attention-ink',
    strong: 'border-strong/40 bg-strong-soft text-strong-ink',
    developing: 'border-developing/40 bg-developing-soft text-developing-ink',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A mastery band is never a colour alone: the word is the label, the colour is
 * reinforcement. This is the only component that renders a band.
 */
export function MasteryPill({ band, className }: { band: MasteryBand; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
        MASTERY_TONE[band],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {MASTERY_LABEL[band]}
    </span>
  );
}

const STEP_STATUS: Record<PlanStepStatus, { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'text-strong-ink bg-strong-soft border-strong/40' },
  active: {
    label: 'In progress',
    tone: 'text-developing-ink bg-developing-soft border-developing/40',
  },
  pending: { label: 'Not started', tone: 'text-ink-muted bg-neutral-soft border-line' },
  skipped: { label: 'Skipped', tone: 'text-ink-muted bg-neutral-soft border-line' },
};

/** The plan table's status column. Word first, dot second. */
export function StatusLabel({
  status,
  className,
}: {
  status: PlanStepStatus;
  className?: string;
}) {
  const { label, tone } = STEP_STATUS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
