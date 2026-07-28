'use client';

import { cn } from '@/lib/cn';

export interface TabOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label, e.g. a count. */
  hint?: string;
}

/**
 * The filter row from the mobile screens: a scrollable strip of pills, the
 * selected one solid near-black. It is a real radiogroup, arrow-key navigable.
 */
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
              selected
                ? 'border-nav bg-nav text-white'
                : 'border-line bg-surface text-ink-muted hover:bg-surface-sunken',
            )}
          >
            {option.label}
            {option.hint ? (
              <span className={selected ? 'text-white/70' : 'text-ink-subtle'}>{option.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
