'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { AccessibilityPreferences } from '@educlm/contracts';
import { cn } from '@/lib/cn';
import { usePreferences } from '@/components/providers/preferences-provider';
import { ChevronRightIcon, TextSizeIcon } from '@/components/ui/icons';

const SCALES: AccessibilityPreferences['fontScale'][] = [1, 1.25, 1.5, 1.75];
const SPACINGS: AccessibilityPreferences['lineSpacing'][] = ['normal', 'relaxed', 'loose'];

const SPACING_LABEL: Record<AccessibilityPreferences['lineSpacing'], string> = {
  normal: 'Normal',
  relaxed: 'Relaxed',
  loose: 'Loose',
};

/**
 * The header's one settings control: a popover holding the reading options
 * that used to sit inline. They stay in the header — the student who needs
 * them needs them while reading — but behind a single, conventional button.
 */
export function DisplaySettings() {
  const { preferences, update, isSaving, saveError } = usePreferences();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Outside click and Escape both close; Escape also returns focus to the
  // trigger so keyboard users are not dropped at the top of the page.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const segment =
    'min-h-8 flex-1 rounded-[5px] px-2 text-xs font-medium transition-colors aria-pressed:bg-nav aria-pressed:text-white';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <TextSizeIcon />
        Display
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Display settings"
          className="absolute right-0 z-40 mt-1.5 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg"
        >
          <fieldset className="mb-3">
            <legend className="mb-1.5 text-xs font-semibold text-ink">Text size</legend>
            <div className="flex gap-1 rounded-md bg-surface-sunken p-0.5" role="group">
              {SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  aria-pressed={preferences.fontScale === scale}
                  onClick={() => update({ fontScale: scale })}
                  className={cn(segment, 'tabular-nums text-ink-muted')}
                >
                  {scale}×
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mb-3">
            <legend className="mb-1.5 text-xs font-semibold text-ink">Line spacing</legend>
            <div className="flex gap-1 rounded-md bg-surface-sunken p-0.5" role="group">
              {SPACINGS.map((spacing) => (
                <button
                  key={spacing}
                  type="button"
                  aria-pressed={preferences.lineSpacing === spacing}
                  onClick={() => update({ lineSpacing: spacing })}
                  className={cn(segment, 'text-ink-muted')}
                >
                  {SPACING_LABEL[spacing]}
                </button>
              ))}
            </div>
          </fieldset>

          <ToggleRow
            label="High contrast"
            checked={preferences.highContrast}
            onChange={(checked) => update({ highContrast: checked })}
          />
          <ToggleRow
            label="Read aloud"
            checked={preferences.readAloud.enabled}
            onChange={(checked) => update({ readAloud: { enabled: checked } })}
          />

          <div className="mt-2 border-t border-line pt-2">
            <Link
              href="/settings"
              prefetch={false}
              onClick={() => setOpen(false)}
              className="flex min-h-9 items-center justify-between rounded-md px-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
            >
              All settings
              <ChevronRightIcon className="text-ink-muted" />
            </Link>
          </div>

          <span aria-live="polite" className="sr-only">
            {isSaving ? 'Saving preference' : (saveError ?? '')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-9 w-full items-center justify-between rounded-md px-1.5 text-sm text-ink transition-colors hover:bg-surface-sunken"
    >
      {label}
      <span
        aria-hidden="true"
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-nav' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
