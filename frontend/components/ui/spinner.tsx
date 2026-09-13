import { cn } from '@/lib/cn';

/**
 * The one busy indicator.
 *
 * A skeleton says "this shape is coming"; a spinner says "something you asked
 * for is running". Both the OS setting and the in-app preference stop the
 * rotation in globals.css, which leaves a legible ring rather than nothing —
 * so the indicator still reads as busy without moving.
 *
 * Decorative by default: the label beside it is what a screen reader announces.
 * Pass `label` only when the spinner stands alone.
 */
export function Spinner({
  size = 'sm',
  label,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}) {
  const px = size === 'lg' ? 28 : size === 'md' ? 20 : 14;

  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      className={cn('shrink-0 animate-spin', className)}
      {...(label ? { role: 'status' as const, 'aria-label': label } : { 'aria-hidden': true })}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
