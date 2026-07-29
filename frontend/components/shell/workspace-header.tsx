'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { useHealth } from '@/lib/hooks/use-meta';
import { ChevronLeft } from '@/components/ui/icons';
import { EduMascot } from '@/components/brand/edu-mascot';
import { DisplaySettings } from './display-settings';

/**
 * One compact row: where you are on the left, the state of the agent and the
 * reading controls on the right. Pinned on anything but the narrowest phone —
 * at 1.75× a pinned header would take the whole viewport.
 */
export function WorkspaceHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  showStatus = true,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  showStatus?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'z-20 border-b border-line bg-surface px-3 py-2.5 sm:sticky sm:top-0 sm:px-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {backHref ? (
          <Link
            href={backHref}
            prefetch={false}
            className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <ChevronLeft />
            {backLabel ?? 'Back'}
          </Link>
        ) : (
          <span className="lg:hidden" aria-hidden="true">
            <EduMascot size={28} eager />
          </span>
        )}

        <div className="min-w-[8rem] flex-1">
          <h1 className="line-clamp-2 font-display text-base font-bold break-words text-ink">
            {title}
          </h1>
          {subtitle ? <p className="truncate text-xs text-ink-muted">{subtitle}</p> : null}
        </div>

        {/* On a phone the controls take their own line so the title keeps its width. */}
        <div className="flex basis-full flex-wrap items-center gap-1.5 sm:basis-auto">
          {showStatus ? <AgentStatus /> : null}
          <DisplaySettings />
          {actions}
        </div>
      </div>
    </header>
  );
}

/**
 * Only speaks up when the API cannot be reached.
 *
 * A permanent "Agent online" pill restates the normal case on every screen; the
 * information a student can act on is the failure, so that is all this renders.
 * `isLoading` stays silent too — a pill that flickers on every navigation reads
 * as a fault rather than as a check.
 */
export function AgentStatus() {
  const { isError } = useHealth();

  if (!isError) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-attention/40 bg-attention-soft px-2 py-1 text-xs font-medium text-attention-ink"
      role="status"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-attention" />
      You&apos;re offline
    </span>
  );
}
