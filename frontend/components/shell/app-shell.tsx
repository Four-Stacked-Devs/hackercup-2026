'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { MobileTabBar } from './mobile-tab-bar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    // The rail and the workspace scroll independently: the sidebar's account
    // row must stay reachable however long the conversation gets.
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar />
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
