'use client';

import { Suspense, type ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { MobileTabBar } from './mobile-tab-bar';

export function AppShell({ children }: { children: ReactNode }) {
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
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
        <MobileTabBar />
      </div>
    </div>
  );
}
