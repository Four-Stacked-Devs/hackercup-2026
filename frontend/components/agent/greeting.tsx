'use client';

import { usePreferences } from '@/components/providers/preferences-provider';
import { EduMascot } from '@/components/brand/edu-mascot';

/**
 * The opening of an empty thread: who is here and what they do. Deliberately
 * plain — the mockup leads with the mascot and two lines, and any suggestion
 * of what to ask belongs under a real answer, not above an empty one.
 */
export function Greeting() {
  const { displayName } = usePreferences();
  const firstName = displayName?.split(' ')[0];

  return (
    <div className="flex items-center gap-5 py-6">
      <EduMascot size={104} eager className="hidden shrink-0 sm:block" />

      <div className="min-w-0">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink">
          Hi{firstName ? ` ${firstName}` : ''}! <span aria-hidden="true">👋</span>
        </h2>
        <p className="mt-2 text-base text-ink">I&apos;m EDU, your AI learning partner.</p>
        <p className="text-base text-ink">How can I help you learn today?</p>
      </div>
    </div>
  );
}
