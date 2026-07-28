'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LearningPlan } from '@educlm/contracts';
import {
  completePlanStep,
  dismissFinding,
  getFinding,
  getPlan,
  getProgressOverview,
  getTopicProgress,
  revertAdaptation,
  skipPlanStep,
} from '../api/endpoints';
import { queryKeys } from '../query-keys';

/** The whole Progress screen arrives in this one call. */
export function useProgressOverview(materialId: string | null) {
  return useQuery({
    queryKey: queryKeys.progress(materialId ?? 'none'),
    queryFn: ({ signal }) => getProgressOverview(materialId as string, signal),
    enabled: Boolean(materialId),
  });
}

export function useTopicProgress(topicId: string | null) {
  return useQuery({
    queryKey: queryKeys.topicProgress(topicId ?? 'none'),
    queryFn: ({ signal }) => getTopicProgress(topicId as string, signal),
    enabled: Boolean(topicId),
  });
}

/**
 * The overview already carries `topFinding` with its evidence, so this only
 * runs for a finding the overview did not include.
 */
export function useFinding(findingId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.finding(findingId ?? 'none'),
    queryFn: ({ signal }) => getFinding(findingId as string, signal),
    enabled: Boolean(findingId) && enabled,
  });
}

export function useDismissFinding(materialId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (findingId: string) => dismissFinding(findingId),
    onSuccess: (finding) => {
      queryClient.setQueryData(queryKeys.finding(finding.id), finding);
      if (materialId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.progress(materialId) });
      }
    },
  });
}

export function usePlan(materialId: string | null) {
  return useQuery({
    queryKey: queryKeys.plan(materialId ?? 'none'),
    queryFn: ({ signal }) => getPlan(materialId as string, signal),
    enabled: Boolean(materialId),
  });
}

function planMutationOptions(
  queryClient: ReturnType<typeof useQueryClient>,
  materialId: string | null,
) {
  return {
    onSuccess: (plan: LearningPlan) => {
      if (!materialId) return;
      queryClient.setQueryData(queryKeys.plan(materialId), plan);
      void queryClient.invalidateQueries({ queryKey: queryKeys.progress(materialId) });
    },
  };
}

export function useCompletePlanStep(materialId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => completePlanStep(stepId),
    ...planMutationOptions(queryClient, materialId),
  });
}

export function useSkipPlanStep(materialId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => skipPlanStep(stepId),
    ...planMutationOptions(queryClient, materialId),
  });
}

/** "Go back to the original plan" — the student's veto over an adaptation. */
export function useRevertAdaptation(materialId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revertAdaptation(materialId as string),
    ...planMutationOptions(queryClient, materialId),
  });
}
