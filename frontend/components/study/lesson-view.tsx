'use client';

import { useState } from 'react';
import type { Lesson, LessonSection } from '@educlm/contracts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Markdown } from '@/components/ui/markdown';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { ClockIcon, PauseIcon, SpeakerIcon } from '@/components/ui/icons';
import { PageRef } from '@/components/source/source-sheet';
import { usePreferences } from '@/components/providers/preferences-provider';
import { useReadAloud } from '@/lib/hooks/use-read-aloud';
import { cn } from '@/lib/cn';

/**
 * The reader. The lesson is the page; the agent supports it from the side.
 *
 * Every section keeps its page reference, and a section the converter is not
 * sure about says so quietly rather than shouting a warning.
 */
export function LessonView({
  lesson,
  isPending,
  isError,
  error,
  onRetry,
}: {
  lesson: Lesson | undefined;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  if (isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading the lesson">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError) return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
  if (!lesson) return null;

  return (
    <article className="pb-10">
      <header className="mb-5">
        <h2 className="font-display text-2xl font-extrabold text-ink">{lesson.topicName}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <ClockIcon width="1em" height="1em" />
          About {lesson.readingTimeMinutes} min to read
          <span aria-hidden="true">·</span>
          <span>Rewritten for reading by {lesson.generatedBy}</span>
        </p>
      </header>

      <div className="space-y-7">
        {lesson.sections.map((section) => (
          <LessonSectionBlock key={section.id} section={section} />
        ))}
      </div>
    </article>
  );
}

function LessonSectionBlock({ section }: { section: LessonSection }) {
  const { preferences } = usePreferences();
  const [readAloudOpen, setReadAloudOpen] = useState(false);
  const readAloud = useReadAloud(section.bodyMarkdown, preferences.readAloud.rate);

  const showControls = preferences.readAloud.enabled && readAloud.supported;
  const reading = readAloudOpen && readAloud.speaking;

  return (
    <section aria-labelledby={section.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={section.id} className="font-display text-xl font-bold text-ink">
          {section.heading}
        </h3>
        <span className="flex items-center gap-2">
          {section.sourcePages.map((page) => (
            <PageRef key={page} page={page} />
          ))}
          {showControls ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReadAloudOpen(true);
                readAloud.toggle();
              }}
              aria-pressed={reading}
            >
              {reading ? <PauseIcon /> : <SpeakerIcon />}
              {reading ? 'Pause' : 'Read aloud'}
            </Button>
          ) : null}
        </span>
      </div>

      {section.needsReview ? (
        <p className="mt-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {section.kind === 'table'
            ? 'Converted from a table. Check the original if something looks off.'
            : section.kind === 'equation'
              ? 'This part contains an equation. Check the original to be sure of the symbols.'
              : 'Converted from a figure. Check the original for the picture.'}{' '}
          <PageRef page={section.sourcePages[0] ?? 1} />
        </p>
      ) : null}

      {reading ? (
        <p className="mt-3 text-base leading-relaxed" aria-live="off">
          {readAloud.sentences.map((sentence, index) => (
            <span
              key={`${sentence.slice(0, 12)}-${index}`}
              className={cn(index === readAloud.index && 'read-aloud-active')}
            >
              {sentence}{' '}
            </span>
          ))}
        </p>
      ) : (
        <Markdown className="mt-2 text-ink">{section.bodyMarkdown}</Markdown>
      )}
    </section>
  );
}

/** Shown when a material has topics but no lesson yet. */
export function LessonPlaceholder() {
  return (
    <Card>
      <h2 className="font-display text-lg font-bold text-ink">Pick a topic to start reading</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Choose a topic from the list and EducLM will open its accessible version, with the
        original page one tap away.
      </p>
      <Chip className="mt-3" tone="neutral">
        Nothing is loaded yet
      </Chip>
    </Card>
  );
}
