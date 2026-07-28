'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/query-keys';
import { clearChat } from '@/lib/api/endpoints';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { usePreferences } from '@/components/providers/preferences-provider';
import { EduMascot } from '@/components/brand/edu-mascot';
import { BellIcon, HelpIcon, PlusIcon, ProfileIcon, SettingsIcon } from '@/components/ui/icons';
import { railNav, type NavItem } from './nav-items';

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  const base = href.split('?')[0] ?? href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

const ROW = 'flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors';

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;

  if (!item.href) {
    return (
      <li>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={`${item.label} — ${item.unavailableReason ?? 'not in this build'}`}
          className={cn(ROW, 'w-full cursor-not-allowed text-left text-nav-ink-muted opacity-60')}
        >
          <Icon />
          <span className="truncate">{item.label}</span>
          <span className="sr-only"> — not in this build</span>
        </button>
      </li>
    );
  }

  const active = isActive(pathname, item.href);

  return (
    <li>
      <Link
        href={item.href}
        prefetch={false}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW,
          active
            ? 'bg-lime font-semibold text-lime-ink'
            : 'text-nav-ink hover:bg-nav-raised',
        )}
      >
        <Icon />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}

/** The fixed rail: brand, one primary action, the modules, then the account. */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { materialId } = useCurrentMaterial();
  const { displayName } = usePreferences();

  async function startNewChat() {
    if (materialId) {
      await clearChat(materialId).catch(() => undefined);
      queryClient.setQueryData(queryKeys.chat(materialId), []);
    }
    router.push('/');
  }

  return (
    <nav
      data-nav
      aria-label="Main"
      className="hidden w-[216px] shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-nav px-2.5 py-3.5 lg:flex"
    >
      <Link href="/" prefetch={false} className="mb-4 flex items-center gap-2 px-1.5 py-1">
        <EduMascot size={28} eager />
        <span className="font-display text-lg font-extrabold tracking-tight text-white">
          Educ<span className="text-lime">LM</span>
        </span>
      </Link>

      <button
        type="button"
        onClick={() => void startNewChat()}
        className="mb-4 flex min-h-10 w-full items-center gap-2 rounded-md bg-lime px-2.5 text-sm font-semibold text-lime-ink transition-colors hover:bg-lime-strong"
      >
        <PlusIcon />
        New chat
      </button>

      <ul className="flex flex-col gap-0.5">
        {railNav(materialId).map((item) => (
          <NavRow key={item.key} item={item} pathname={pathname} />
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-2.5">
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Learning profile — not in this build"
          className={cn(ROW, 'cursor-not-allowed text-left text-nav-ink-muted opacity-60')}
        >
          <ProfileIcon />
          Learning profile
          <span className="sr-only"> — not in this build</span>
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Notifications — not in this build"
          className={cn(ROW, 'cursor-not-allowed text-left text-nav-ink-muted opacity-60')}
        >
          <BellIcon />
          Notifications
          <span className="sr-only"> — not in this build</span>
        </button>
        <Link
          href="/about/ai-use"
          prefetch={false}
          aria-current={isActive(pathname, '/about/ai-use') ? 'page' : undefined}
          className={cn(
            ROW,
            isActive(pathname, '/about/ai-use')
              ? 'bg-lime font-semibold text-lime-ink'
              : 'text-nav-ink hover:bg-nav-raised',
          )}
        >
          <HelpIcon />
          How EducLM uses AI
        </Link>
        <Link
          href="/settings"
          prefetch={false}
          aria-current={isActive(pathname, '/settings') ? 'page' : undefined}
          className={cn(
            ROW,
            isActive(pathname, '/settings')
              ? 'bg-lime font-semibold text-lime-ink'
              : 'text-nav-ink hover:bg-nav-raised',
          )}
        >
          <SettingsIcon />
          Settings
        </Link>

        <div className="mt-1.5 flex items-center gap-2.5 rounded-md bg-nav-raised px-2.5 py-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime text-xs font-bold text-lime-ink"
          >
            {(displayName ?? 'S').slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">
              {displayName ?? 'Student'}
            </span>
            <span className="block text-xs text-nav-ink-muted">Anonymous device</span>
          </span>
        </div>
      </div>
    </nav>
  );
}
