import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'nav';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // The one accent: every committing action is lime with near-black label.
  primary: 'bg-lime text-lime-ink hover:bg-lime-strong border border-transparent font-semibold',
  dark: 'bg-nav text-white hover:bg-nav-raised border border-transparent font-semibold',
  outline: 'bg-surface text-ink border border-line-strong hover:bg-surface-sunken font-medium',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-surface-sunken font-medium',
  danger: 'bg-surface text-attention-ink border border-attention hover:bg-attention-soft font-medium',
  nav: 'bg-transparent text-nav-ink border border-transparent hover:bg-nav-raised',
};

// 44px minimum on anything a thumb has to hit.
const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-2.5 text-xs gap-1.5',
  md: 'min-h-11 px-3.5 text-sm gap-2',
  lg: 'min-h-12 px-4 text-sm gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-normal text-left';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
}

export function Button({
  variant = 'outline',
  size = 'md',
  full = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], full && 'w-full', className)}
      {...props}
    />
  );
}

export function ButtonLink({
  href,
  variant = 'outline',
  size = 'md',
  full = false,
  className,
  children,
  prefetch,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  full?: boolean;
  className?: string;
  children: ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch ?? false}
      className={cn(BASE, VARIANTS[variant], SIZES[size], full && 'w-full', className)}
    >
      {children}
    </Link>
  );
}

/**
 * A control the mockups show but this build does not implement, because no
 * endpoint backs it. It stays visible and clearly unavailable rather than
 * pretending to work.
 */
export function NotBuiltButton({
  label,
  children,
  className,
  size = 'md',
}: {
  label: string;
  children: ReactNode;
  className?: string;
  size?: Size;
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={`${label} — not in this build`}
      className={cn(
        BASE,
        SIZES[size],
        'cursor-not-allowed border border-dashed border-line-strong bg-transparent text-ink-muted',
        className,
      )}
    >
      {children}
      <span className="sr-only"> — not in this build</span>
    </button>
  );
}
