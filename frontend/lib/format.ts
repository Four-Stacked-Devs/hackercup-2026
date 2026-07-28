import type { Confidence, Difficulty, MasteryBand, PlanStepKind } from '@educlm/contracts';

/**
 * Every band carries a word. Colour never carries meaning on its own — that is
 * both the accessibility rule and the reason these labels live in one place.
 */
export const MASTERY_LABEL: Record<MasteryBand, string> = {
  strong: 'Strong',
  developing: 'Developing',
  needs_attention: 'Needs attention',
  insufficient_data: 'Not enough data yet',
};

export const MASTERY_TONE: Record<MasteryBand, string> = {
  strong: 'text-strong-ink border-strong/40 bg-strong-soft',
  developing: 'text-developing-ink border-developing/40 bg-developing-soft',
  needs_attention: 'text-attention-ink border-attention/40 bg-attention-soft',
  insufficient_data: 'text-ink-muted border-line bg-neutral-soft',
};

/** The bar colour that goes with each band, for Meter and ProgressBar. */
export const MASTERY_BAR: Record<MasteryBand, 'strong' | 'developing' | 'attention' | 'neutral'> = {
  strong: 'strong',
  developing: 'developing',
  needs_attention: 'attention',
  insufficient_data: 'neutral',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  none: 'No evidence yet',
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

export const STEP_KIND_LABEL: Record<PlanStepKind, string> = {
  read: 'Read',
  practice: 'Practise',
  review: 'Review',
  advance: 'Move on',
};

export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMinutes = Math.round((then - Date.now()) / 60000);

  if (Math.abs(diffMinutes) < 60) return relative.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relative.format(diffHours, 'hour');
  return relative.format(Math.round(diffHours / 24), 'day');
}

export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    new Date(iso),
  );
}
