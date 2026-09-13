'use client';

import { Suspense, type ReactNode } from 'react';
import { IS_UNEXPECTED_MOCK } from '@/lib/config';
import { useServerRecovery } from '@/lib/hooks/use-server-recovery';
import { Sidebar } from './sidebar';
import { MobileTabBar } from './mobile-tab-bar';

/**
 * Demo fixtures reached a real build.
 *
 * Nothing on screen looks any different in mock mode — the accuracy figures,
 * mastery bands and findings are all invented, and a student cannot tell. One
 * line in Settings was not enough to say so, so it is said on every screen.
 */
function MockDataBanner() {
  if (!IS_UNEXPECTED_MOCK) return null;

  return (
    <p
      role="status"
      className="border-b border-attention/40 bg-attention-soft px-3 py-1.5 text-center text-xs font-semibold text-attention-ink"
    >
      Demo data — every number here is sample content, not your work.
    </p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  // Releases every screen once the server answers again — see the hook.
  useServerRecovery();

  return (
    // The rail and the workspace scroll independently: the sidebar's account
    // row must stay reachable however long the conversation gets.
    <div className="flex h-dvh overflow-hidden bg-canvas">
      {/* The rail reads the open thread from the query string, which Next
          requires a suspense boundary for. */}
      <Suspense fallback={<div aria-hidden="true" className="hidden w-[256px] shrink-0 bg-nav lg:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <nav aria-label="Skip links">
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
        </nav>
        <MockDataBanner />
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}
