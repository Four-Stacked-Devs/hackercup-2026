'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MATERIAL_STATUS_POLL_MS, type Material } from '@educlm/contracts';
import {
  createMaterial,
  deleteMaterial,
  getMaterial,
  getMaterialStatus,
  listMaterials,
} from '../api/endpoints';
import { queryKeys } from '../query-keys';

export function useMaterials() {
  return useQuery({
    queryKey: queryKeys.materials(),
    queryFn: ({ signal }) => listMaterials(signal),
    /**
     * Ingestion runs server-side and finishes on its own, so the list keeps
     * asking while anything is still being prepared. Without this a course sits
     * on "Preparing…" until the student reloads, and the chat screen never
     * notices that it may start answering. Settles to no polling once every
     * material is ready or failed.
     */
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (material) => material.status !== 'ready' && material.status !== 'failed',
      )
        ? MATERIAL_STATUS_POLL_MS
        : false,
    refetchIntervalInBackground: true,
  });
}

export function useMaterial(id: string | null) {
  return useQuery({
    queryKey: queryKeys.material(id ?? 'none'),
    queryFn: ({ signal }) => getMaterial(id as string, signal),
    enabled: Boolean(id),
  });
}

/**
 * Polls at the interval the contract prescribes, and only while ingestion is
 * still running — a ready material stops making requests.
 */
export function useMaterialStatus(id: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.materialStatus(id ?? 'none'),
    queryFn: ({ signal }) => getMaterialStatus(id as string, signal),
    enabled: Boolean(id) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : MATERIAL_STATUS_POLL_MS;
    },
    // Ingestion keeps running whether or not the tab is in front, so the poll
    // does too — coming back to the tab shows the truth, not a frozen bar.
    refetchIntervalInBackground: true,
  });
}

export function useUploadMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, title }: { file: File; title?: string }) =>
      createMaterial(file, title),
    onSuccess: (material: Material) => {
      queryClient.setQueryData(queryKeys.material(material.id), material);
      void queryClient.invalidateQueries({ queryKey: queryKeys.materials() });
    },
  });
}

export function useDeleteMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteMaterial(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.material(id) });
      queryClient.removeQueries({ queryKey: queryKeys.progress(id) });
      queryClient.removeQueries({ queryKey: queryKeys.plan(id) });
      queryClient.removeQueries({ queryKey: queryKeys.topics(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.materials() });
    },
  });
}
