'use client';

import type { IngestionStage } from '@educlm/contracts';
import { ProgressBar } from '@/components/ui/charts';
import { CheckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * How a material's preparation is shown, in one place.
 *
 * Ingestion runs server-side and keeps going wherever the student navigates, so
 * the same progress has to be readable from the upload panel, the chat screen
 * and the course list. Sharing the component keeps those three honest about the
 * same stage names rather than inventing their own wording.
 */

/** Plain language for each ingestion stage. No jargon, no spinner-only states. */
export const STAGE_LABEL: Record<IngestionStage, string> = {
  extracting: 'Reading the pages',
  chunking: 'Splitting the text into passages',
  extracting_topics: 'Finding the topics',
  embedding: 'Indexing it so answers can cite a page',
  building_lessons: 'Building the accessible lesson',
  done: 'Ready',
};

export const STAGE_ORDER: IngestionStage[] = [
  'extracting',
  'chunking',
  'extracting_topics',
  'embedding',
  'building_lessons',
];

export interface Progress {
  stage: IngestionStage;
  percent: number;
  message: string;
}

/**
 * Reads the progress out of a material or a status response — both carry the
 * same `processing` block, and both may not carry it yet: the row exists before
 * the first stage is written. Falling back to the opening stage keeps the bar
 * honest instead of blank.
 */
export function progressOf(
  source: { processing?: Partial<Progress> | null } | null | undefined,
): Progress {
  return {
    stage: source?.processing?.stage ?? 'extracting',
    percent: source?.processing?.percent ?? 0,
    message: source?.processing?.message ?? STAGE_LABEL.extracting,
  };
}

/** The full list, for the upload panel and the chat screen. This is not a spinner. */
export function ProcessingStages({ stage, percent, message }: Progress) {
  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div>
      <p className="font-display font-bold text-ink" aria-live="polite">
        {message}
      </p>

      <div className="mt-3">
        <ProgressBar value={percent / 100} label="Preparing your material" />
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">
        {percent}% · usually under a minute for a module this size.
      </p>

      <ol className="mt-4 m-0 list-none space-y-1.5">
        {STAGE_ORDER.map((entry, index) => {
          const done = currentIndex > index;
          const active = currentIndex === index;

          return (
            <li
              key={entry}
              className={cn(
                'flex items-center gap-2 text-sm',
                done ? 'text-ink-muted' : active ? 'font-medium text-ink' : 'text-ink-muted opacity-60',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  done
                    ? 'border-strong bg-strong text-white'
                    : active
                      ? 'border-nav bg-nav text-white'
                      : 'border-line',
                )}
              >
                {done ? <CheckIcon width="0.8em" height="0.8em" /> : null}
              </span>
              {STAGE_LABEL[entry]}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * One line and a bar, for a course card where the full list would not fit.
 * Same numbers, same wording — just less of it.
 */
export function ProcessingSummary({
  stage,
  percent,
  message,
  className,
}: Progress & { className?: string }) {
  const step = STAGE_ORDER.indexOf(stage);

  return (
    <div className={className}>
      <ProgressBar value={percent / 100} label={`Preparing: ${message}`} />
      <p className="mt-1 text-xs text-ink-muted">
        {message} · {percent}%
        {step >= 0 ? ` · step ${step + 1} of ${STAGE_ORDER.length}` : ''}
      </p>
    </div>
  );
}
