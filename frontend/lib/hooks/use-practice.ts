'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePracticeSetRequest,
  PracticeSet,
  SubmitResponseRequest,
} from '@educlm/contracts';
import {
  completePracticeSet,
  createPracticeSet,
  getPracticeSet,
  submitResponse,
} from '../api/endpoints';
import { queryKeys } from '../query-keys';

export function usePracticeSet(setId: string | null) {
  return useQuery({
    queryKey: queryKeys.practiceSet(setId ?? 'none'),
    queryFn: ({ signal }) => getPracticeSet(setId as string, signal),
    enabled: Boolean(setId),
  });
}

export function useCreatePracticeSet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreatePracticeSetRequest) => createPracticeSet(body),
    onSuccess: (set: PracticeSet) => {
      queryClient.setQueryData(queryKeys.practiceSet(set.id), set);
    },
  });
}

/**
 * The answer reveal is always this round-trip: the question carries no key.
 *
 * Every answer moves mastery, findings and the trend server-side, so the screens
 * built on those are stale from the moment it lands. Invalidating only on
 * completion meant abandoning a set half-way left Progress and Analytics showing
 * pre-answer numbers.
 */
export function useSubmitResponse(setId: string, materialId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitResponseRequest) => submitResponse(setId, body),
    onSuccess: () => {
      if (!materialId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.progress(materialId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.topics(materialId) });
    },
  });
}

/**
 * Completing a set is what makes the plan visibly change, so progress and plan
 * are both invalidated here.
 */
export function useCompletePracticeSet(setId: string, materialId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => completePracticeSet(setId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.practiceSet(setId) });
      if (materialId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.progress(materialId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.plan(materialId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.topics(materialId) });
      }
    },
  });
}
