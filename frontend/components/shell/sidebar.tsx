'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { usePreferences } from '@/components/providers/preferences-provider';
import { useThreads } from '@/lib/hooks/use-threads';
import { EduMascot } from '@/components/brand/edu-mascot';
import { ChevronDownIcon, CollapseIcon, PlusIcon } from '@/components/ui/icons';
import { railNav, type NavItem } from './nav-items';
import { ThreadList } from './thread-list';

const COLLAPSED_KEY = 'educlm.sidebar-collapsed';

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  const base = href.split('?')[0] ?? href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

const ROW = 'flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors';

function NavRow({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const Icon = item.icon;

  if (!item.href) {
    return (
      <li>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={`${item.label} — ${item.unavailableReason ?? 'not in this build'}`}
          className={cn(
            ROW,
            'w-full cursor-not-allowed text-left text-nav-ink-muted opacity-60',
            collapsed && 'justify-center px-0',
          )}
        >
          <Icon />
          {collapsed ? null : <span className="truncate">{item.label}</span>}
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
        title={collapsed ? item.label : undefined}
        className={cn(
          ROW,
          active ? 'bg-lime font-semibold text-lime-ink' : 'text-nav-ink hover:bg-nav-raised',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon />
        {collapsed ? null : <span className="truncate">{item.label}</span>}
        {collapsed ? <span className="sr-only">{item.label}</span> : null}
      </Link>
    </li>
  );
}

/**
 * The rail: brand, the New Chat action, the four destinations, the
 * conversation history, then the account row pinned to the bottom.
 *
 * Collapsing folds it to an icon rail. The choice is per-browser and cosmetic,
 * so it lives in localStorage and is read after mount — the first paint is
 * always expanded, which keeps server and client markup identical.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { materialId } = useCurrentMaterial();
  const { displayName } = usePreferences();
  const { threads, isPending } = useThreads(materialId);

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      // Unavailable storage just means the rail starts expanded.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Not persisting is fine; the toggle still works for the session.
      }
      return next;
    });
  };

  const activeTopicId = pathname === '/' ? searchParams.get('topic') : null;
  const threadParam = pathname === '/' ? searchParams.get('thread') : null;
  const ungroupedOpen = threadParam === 'all';
  // Anything other than `all` is one conversation started from the greeting.
  const activeThreadKey = threadParam === 'all' ? null : threadParam;

  const toggle = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="rounded-sm p-1 text-nav-ink-muted transition-colors hover:bg-nav-raised hover:text-nav-ink"
    >
      <CollapseIcon className={cn('transition-transform', collapsed && 'rotate-180')} />
      <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
    </button>
  );

  return (
    <nav
      data-nav
      aria-label="Main"
      className={cn(
        'hidden shrink-0 flex-col overflow-hidden bg-nav py-3.5 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-16 px-2' : 'w-[256px] px-2.5',
      )}
    >
      {collapsed ? (
        <div className="mb-4 flex flex-col items-center gap-2">
          <Link href="/" prefetch={false} title="EducLM home" className="py-1">
            <EduMascot size={26} eager />
            <span className="sr-only">EducLM home</span>
          </Link>
          {toggle}
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-2 px-1.5">
          <Link href="/" prefetch={false} className="flex items-center gap-2 py-1">
            <EduMascot size={26} eager />
            <span className="font-display text-lg font-extrabold tracking-tight text-white">
              Educ<span className="text-lime">LM</span>
            </span>
          </Link>
          {toggle}
        </div>
      )}

      {/*
        New Chat clears only the client's idea of which thread is open. It does
        not call DELETE /chat: the log is the student's history, and starting a
        new conversation is not a request to erase the old one.
      */}
      <button
        type="button"
        onClick={() => router.push('/')}
        title={collapsed ? 'New Chat' : undefined}
        className={cn(
          'flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-lime text-sm font-semibold text-lime-ink transition-colors hover:bg-lime-strong',
          collapsed ? 'px-0' : 'px-2.5',
        )}
      >
        <PlusIcon />
        {collapsed ? <span className="sr-only">New Chat</span> : 'New Chat'}
      </button>

      <ul className="mt-4 flex flex-col gap-0.5">
        {railNav(materialId).map((item) => (
          <NavRow key={item.key} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </ul>

      {collapsed ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <ThreadList
          threads={threads}
          activeTopicId={activeTopicId}
          activeThreadKey={activeThreadKey}
          ungroupedOpen={ungroupedOpen}
          isPending={isPending}
        />
      )}

      <div className="mt-2 border-t border-white/10 pt-2.5">
        <Link
          href="/settings"
          prefetch={false}
          title={collapsed ? 'Settings' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md transition-colors hover:bg-white/15',
            collapsed ? 'justify-center py-1.5' : 'bg-nav-raised px-2.5 py-2 text-left',
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lime text-xs font-bold text-lime-ink"
          >
            {(displayName ?? 'S').slice(0, 1).toUpperCase()}
          </span>
          {collapsed ? (
            <span className="sr-only">{displayName ?? 'Student'} — Settings</span>
          ) : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {displayName ?? 'Student'}
                </span>
                <span className="block text-xs text-nav-ink-muted">Anonymous device</span>
              </span>
              <ChevronDownIcon className="shrink-0 text-nav-ink-muted" />
            </>
          )}
        </Link>
      </div>
    </nav>
  );
}
