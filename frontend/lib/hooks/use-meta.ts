'use client';

import { useQuery } from '@tanstack/react-query';
import { getAiDisclosure, getHealth } from '../api/endpoints';
import { queryKeys } from '../query-keys';

export function useAiDisclosure() {
  return useQuery({
    queryKey: queryKeys.aiDisclosure(),
    queryFn: ({ signal }) => getAiDisclosure(signal),
    staleTime: 60 * 60 * 1000,
  });
}

/** Backs the "Agent online / You're offline" indicator from the wireframe. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => getHealth(signal),
    // Knock more often while the server is away so recovery shows quickly.
    refetchInterval: (query) => (query.state.status === 'error' ? 5_000 : 30_000),
    retry: 1,
    staleTime: 10_000,
  });
}
