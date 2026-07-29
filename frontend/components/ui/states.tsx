'use client';

import type { ReactNode } from 'react';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { useHealth } from '@/lib/hooks/use-meta';
import { EduMascot } from '@/components/brand/edu-mascot';
import { AlertIcon, RefreshIcon } from './icons';
import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-3.5 w-full', className)} aria-hidden="true" />;
}

/** Skeletons mirror the layout they stand in for, so nothing jumps on arrival. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface p-4', className)}
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('mb-2 h-3', index === lines - 1 && 'w-2/3')} />
      ))}
    </div>
  );
}

/**
 * Shown with a skeleton while the server is unreachable. Quiet by design: the
 * queries behind the skeleton keep retrying on their own, so this is a note,
 * not a call to action. Renders nothing while the server is fine.
 */
export function ReconnectNote() {
  const { isError } = useHealth();
  if (!isError) return null;

  return (
    <p
      role="status"
      className="flex items-center gap-2 px-1 text-xs text-ink-muted"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-attention" />
      Trying to reconnect…
    </p>
  );
}

/**
 * A whole screen's placeholder, shaped like the layout it stands in for.
 * Every variant carries the reconnect note so an unreachable server reads as
 * "loading, and here's why it's slow" rather than as a dead end.
 */
export function ScreenSkeleton({
  variant,
  className,
}: {
  variant: 'chat' | 'grid' | 'list' | 'stats';
  className?: string;
}) {
  return (
    <div className={cn('space-y-3 p-4', className)} role="status" aria-label="Loading">
      <ReconnectNote />
      {variant === 'chat' ? (
        <>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </>
      ) : null}
      {variant === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonCard key={index} lines={3} />
          ))}
        </div>
      ) : null}
      {variant === 'list' ? (
        <>
          <SkeletonCard lines={1} />
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonCard key={index} lines={2} />
          ))}
        </>
      ) : null}
      {variant === 'stats' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonCard key={index} lines={2} />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <SkeletonCard lines={6} />
            <SkeletonCard lines={6} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** An empty screen is an invitation, and EDU is the one making it. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** Overrides the mascot when a plain icon suits the context better. */
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-5 py-6 text-center">
      <div className="mb-2 flex justify-center text-ink-muted">
        {icon ?? <EduMascot size={56} />}
      </div>
      <h3 className="font-display text-sm font-bold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-[48ch] text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * The state this product needs most: no data yet, said plainly, with the one
 * thing that would fix it. Never a zero, never a 0% bar.
 */
export function InsufficientData({
  what,
  fix,
  className,
}: {
  what: string;
  fix: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-line-strong bg-surface-sunken px-3 py-2.5 text-sm',
        className,
      )}
    >
      <p className="font-semibold text-ink">Not enough data yet</p>
      <p className="mt-0.5 text-ink-muted">
        {what} {fix}
      </p>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message = isApiError(error) ? error.message : 'Something went wrong. Please try again.';
  const code = isApiError(error) ? error.code : null;

  return (
    <div
      className={cn('rounded-lg border border-attention/40 bg-attention-soft p-3.5', className)}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertIcon className="mt-0.5 shrink-0 text-attention" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-ink">Something went wrong</p>
          <p className="mt-0.5 text-sm text-ink">{message}</p>
          {code ? <p className="mt-1 text-xs text-ink-muted">Reference: {code}</p> : null}
          {onRetry ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshIcon />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The offline strip. */
export function OfflineNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm"
      role="status"
    >
      <AlertIcon className="text-ink-muted" />
      <span className="text-ink">
        You&apos;re offline. EducLM can&apos;t reach the server, so nothing new will load.
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Check again
      </Button>
    </div>
  );
}
