'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';

/** The server never answered at all — as opposed to answering with an error. */
function isUnreachable(error: unknown): boolean {
  return isApiError(error) && error.status === 0;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            // An unreachable server is a condition to wait out, not an error
            // to show: screens hold their skeletons and this keeps knocking.
            // Retrying a 404 or a validation error only delays the error
            // state the student needs to see.
            retry: (failureCount, error) => {
              if (isUnreachable(error)) return true;
              if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
