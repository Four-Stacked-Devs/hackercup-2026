'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROUTES } from '@educlm/contracts';
import { apiUrl } from '../api/client';

/** How often to knock while something is stuck. */
const PING_MS = 5_000;

/**
 * Gets the app moving again after the server comes back.
 *
 * React Query pauses a query's retries whenever the document is hidden — and a
 * paused query reports `status: 'pending'` with `fetchStatus: 'paused'`, which
 * is neither loading nor an error. Once paused it waits for a focus or online
 * event that may never arrive, so a server that goes away for a moment can
 * leave every screen holding a skeleton until the student reloads the page.
 *
 * This is the one thing that does not go through the query cache: a plain
 * `fetch` at the health endpoint, run only while something is actually stuck.
 * Pausing applies to retries, not to a fresh fetch, so refetching once the
 * server answers is enough to release everything.
 */
export function useServerRecovery(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Pending with nothing to show and at least one failure behind it. */
    const isStalled = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.state.fetchStatus === 'paused' ||
            (query.state.status === 'pending' && query.state.fetchFailureCount > 0),
        );

    const tick = async () => {
      if (cancelled) return;

      if (isStalled()) {
        try {
          const response = await fetch(apiUrl(ROUTES.meta.health()), {
            headers: { Accept: 'application/json' },
          });
          if (!cancelled && response.ok) {
            // Cancel before refetching. A paused fetch still counts as in
            // flight, so `refetchQueries` on its own is deduped into it and
            // nothing new is ever sent — the screens stay on their skeletons
            // even though the server is answering again.
            await queryClient.cancelQueries();
            await queryClient.refetchQueries();
          }
        } catch {
          // Still unreachable. The next tick will knock again.
        }
      }

      if (!cancelled) timer = setTimeout(tick, PING_MS);
    };

    timer = setTimeout(tick, PING_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);
}
