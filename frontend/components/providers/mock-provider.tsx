'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { API_MODE } from '@/lib/config';

/**
 * Holds the first paint until the mock worker is intercepting, so no request
 * escapes to the network in mock mode. In live mode this renders immediately.
 */
export function MockProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(API_MODE !== 'mock');

  useEffect(() => {
    if (API_MODE !== 'mock') return;

    let active = true;
    void import('@/mocks/browser').then(async ({ startMockWorker }) => {
      await startMockWorker();
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-canvas px-4 text-center text-sm text-ink-muted"
        role="status"
      >
        Starting EducLM in demo mode…
      </div>
    );
  }

  return <>{children}</>;
}
