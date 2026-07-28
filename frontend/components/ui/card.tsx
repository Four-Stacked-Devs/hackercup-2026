import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A thin rule, a small radius, a shadow you have to look for. */
export function Card({
  className,
  as: Tag = 'section',
  ...props
}: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
  return (
    <Tag
      className={cn(
        // min-w-0: a card inside a grid or flex row must be allowed to shrink,
        // or its longest word sets the width of the whole page at 1.75x.
        'min-w-0 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  action,
  description,
  level = 2,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = (level === 2 ? 'h2' : 'h3') as ElementType;

  return (
    <div className={cn('mb-3 flex flex-wrap items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <Heading className="font-display text-sm font-bold text-ink">{title}</Heading>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * The section heading used between cards — small, heavy, with an optional link
 * on the right, as in "Continue where you left off · View all".
 */
export function SectionHeading({
  title,
  action,
  level = 2,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = (level === 2 ? 'h2' : 'h3') as ElementType;

  return (
    <div className={cn('mb-2.5 flex flex-wrap items-baseline justify-between gap-2', className)}>
      <Heading className="font-display text-sm font-bold text-ink">{title}</Heading>
      {action}
    </div>
  );
}
