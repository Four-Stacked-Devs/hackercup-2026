'use client';

import type { AccessibilityPreferences } from '@educlm/contracts';
import { cn } from '@/lib/cn';
import { usePreferences } from '@/components/providers/preferences-provider';
import { ContrastIcon, SpacingIcon, SpeakerIcon, TextSizeIcon } from '@/components/ui/icons';

const SCALES: AccessibilityPreferences['fontScale'][] = [1, 1.25, 1.5, 1.75];
const SPACINGS: AccessibilityPreferences['lineSpacing'][] = ['normal', 'relaxed', 'loose'];

const SPACING_LABEL: Record<AccessibilityPreferences['lineSpacing'], string> = {
  normal: 'Normal',
  relaxed: 'Relaxed',
  loose: 'Loose',
};

/**
 * Reading controls sit in the header on every screen, not in settings: the
 * student who needs them needs them while reading. Each writes a custom
 * property on <html>, so the page reflows without re-rendering the tree.
 */
export function A11yToolbar({ className }: { className?: string }) {
  const { preferences, update, isSaving, saveError } = usePreferences();

  const nextScale = () => {
    const index = SCALES.indexOf(preferences.fontScale);
    return SCALES[(index + 1) % SCALES.length]!;
  };

  const nextSpacing = () => {
    const index = SPACINGS.indexOf(preferences.lineSpacing);
    return SPACINGS[(index + 1) % SPACINGS.length]!;
  };

  const button =
    'inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';
  const on = 'border-nav bg-nav text-white hover:bg-nav-raised hover:text-white';

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1', className)}
      role="group"
      aria-label="Reading controls"
    >
      <button
        type="button"
        className={button}
        onClick={() => update({ fontScale: nextScale() })}
        aria-label={`Text size: ${preferences.fontScale}×. Change to ${nextScale()}×`}
      >
        <TextSizeIcon />
        <span className="tabular-nums">{preferences.fontScale}×</span>
      </button>

      <button
        type="button"
        className={button}
        onClick={() => update({ lineSpacing: nextSpacing() })}
        aria-label={`Line spacing: ${SPACING_LABEL[preferences.lineSpacing]}. Change to ${SPACING_LABEL[nextSpacing()]}`}
      >
        <SpacingIcon />
        <span className="hidden xl:inline">{SPACING_LABEL[preferences.lineSpacing]}</span>
      </button>

      <button
        type="button"
        className={cn(button, preferences.highContrast && on)}
        aria-pressed={preferences.highContrast}
        aria-label="High contrast"
        onClick={() => update({ highContrast: !preferences.highContrast })}
      >
        <ContrastIcon />
        <span className="hidden xl:inline">Contrast</span>
      </button>

      <button
        type="button"
        className={cn(button, preferences.readAloud.enabled && on)}
        aria-pressed={preferences.readAloud.enabled}
        aria-label="Read aloud"
        onClick={() => update({ readAloud: { enabled: !preferences.readAloud.enabled } })}
      >
        <SpeakerIcon />
        <span className="hidden xl:inline">Read aloud</span>
      </button>

      <span aria-live="polite" className="sr-only">
        {isSaving ? 'Saving preference' : saveError ? saveError : ''}
      </span>
    </div>
  );
}
