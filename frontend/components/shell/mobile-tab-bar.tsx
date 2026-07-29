'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { mobileTabs } from './nav-items';

/** The phone layout is the design, so this is primary navigation, not a fallback. */
export function MobileTabBar() {
  const pathname = usePathname();
  const { materialId } = useCurrentMaterial();

  // Matched on the tab's own route prefix, not its href: a tab that falls
  // back to /materials when no material exists must not light up there.
  const isActive = (key: string) => {
    if (key === 'chat') return pathname === '/';
    // The reader and the practice runner are opened from the explorer, so they
    // keep that tab lit rather than lighting none.
    if (key === 'explorer') {
      return ['/materials', '/library', '/study', '/practice', '/upload'].some((path) =>
        pathname.startsWith(path),
      );
    }
    return pathname.startsWith(`/${key}`);
  };

  return (
    <nav
      data-nav
      aria-label="Main"
      className="sticky bottom-0 z-30 flex shrink-0 gap-0.5 overflow-x-auto border-t border-black/20 bg-nav px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {mobileTabs(materialId).map((item) => {
        const Icon = item.icon;
        const href = item.href ?? '/';
        const active = isActive(item.key);

        return (
          <Link
            key={item.key}
            href={href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // 44px minimum target, label always visible.
              'flex min-h-12 min-w-[4.25rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-1.5 text-[0.6875rem]',
              active ? 'font-semibold text-lime' : 'text-nav-ink-muted',
            )}
          >
            <Icon />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
