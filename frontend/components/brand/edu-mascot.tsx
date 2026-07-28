import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * EDU, the learning agent.
 *
 * The artwork is the delivered render in `public/Asset`, cut out and sized for
 * the web by `npm run mascot` (see scripts/prepare-mascot.ts). Four expressions
 * ship, and each one means something:
 *
 *   default   — greeting, or simply being present
 *   thinking  — EDU is working: streaming an answer, building a set
 *   letsgo    — encouragement: a correct answer, a finished set, a result
 *   wary      — a caution: a misconception, a weak topic, something to watch
 *
 * EDU appears only where the agent speaks for itself. Never as decoration.
 */
export type EduMood = 'default' | 'thinking' | 'letsgo' | 'wary';

const FILE: Record<EduMood, string> = {
  default: 'edu-default',
  thinking: 'edu-thinking',
  letsgo: 'edu-letsgo',
  wary: 'edu-wary',
};

export function EduMascot({
  mood = 'default',
  size = 40,
  className,
  title,
  eager = false,
}: {
  mood?: EduMood;
  /** Rendered size in CSS pixels. Set as width/height too, so nothing shifts. */
  size?: number;
  className?: string;
  /** Give a title only where the drawing carries meaning on its own. */
  title?: string;
  eager?: boolean;
}) {
  const slug = FILE[mood];

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/mascot/${slug}-${size > 48 ? 256 : 96}.png`}
      srcSet={`/mascot/${slug}-96.png 96w, /mascot/${slug}-256.png 256w`}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={cn('shrink-0 select-none object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The strip EDU speaks through — a quiet lime-tinted row used for guidance and
 * encouragement. The expression carries the tone, so the copy does not have to.
 */
export function EduSays({
  children,
  className,
  action,
  mood = 'default',
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  mood?: EduMood;
}) {
  return (
    <aside
      className={cn(
        'flex items-start gap-3 rounded-lg border border-line bg-lime-soft px-3 py-2.5',
        className,
      )}
    >
      <EduMascot mood={mood} size={36} />
      <div className="min-w-0 flex-1 text-sm text-ink">
        <span className="font-semibold">EDU says: </span>
        {children}
      </div>
      {action}
    </aside>
  );
}
