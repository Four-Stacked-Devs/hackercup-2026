'use client';

import { useEffect, useState } from 'react';
import { LONG_WAIT_SECONDS, tipsFor, type TipTopic } from '@/lib/tips';
import { useElapsedSeconds } from '@/lib/hooks/use-elapsed';
import { cn } from '@/lib/cn';
import { EduMascot } from '@/components/brand/edu-mascot';

const ROTATE_MS = 7_000;

/**
 * Something to read while a wait runs, and an honest word when it runs long.
 *
 * `aria-live` is deliberately off: a line that replaces itself every seven
 * seconds would interrupt a screen reader over and over, and none of it is
 * information the student needs at that moment. The spinner and the status
 * text beside it are what announce the wait.
 */
export function LoadingTips({
  topic,
  longWaitNote,
  className,
}: {
  topic: TipTopic;
  /** Shown once the wait has run long. Omit to say nothing. */
  longWaitNote?: string;
  className?: string;
}) {
  const tips = tipsFor(topic);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const elapsed = useElapsedSeconds(LONG_WAIT_SECONDS + 1);

  useEffect(() => {
    if (paused || tips.length < 2) return;

    const timer = setInterval(() => setIndex((current) => (current + 1) % tips.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, tips.length]);

  return (
    <div
      className={cn('rounded-md border border-line bg-surface-sunken px-3 py-2.5', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-start gap-2.5">
        <EduMascot size={22} className="mt-0.5 shrink-0" />
        <p className="m-0 text-sm leading-relaxed text-ink-muted">{tips[index]}</p>
      </div>

      {longWaitNote && elapsed >= LONG_WAIT_SECONDS ? (
        <p className="mt-2 border-t border-line pt-2 text-xs text-ink-subtle">{longWaitNote}</p>
      ) : null}
    </div>
  );
}
