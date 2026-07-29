'use client';

import { useQueries } from '@tanstack/react-query';
import type { Material, MasteryBand } from '@educlm/contracts';
import { getProgressOverview } from '../api/endpoints';
import { queryKeys } from '../query-keys';

export interface MaterialProgress {
  /** Share of answered questions that were correct, or null with no responses. */
  accuracy: number | null;
  responseCount: number;
  topicsMastered: number;
  /** The weakest band present, for the card's status word. Null with no data. */
  weakestBand: MasteryBand | null;
  lastAnsweredAt: string | null;
}

/**
 * Progress for several materials at once.
 *
 * There is no bulk endpoint, so this fans out one `GET /progress/overview` per
 * ready material. Materials still ingesting are skipped — they have no
 * responses yet, and asking would only burn a request.
 */
export function useMaterialsProgress(materials: readonly Material[]) {
  const ready = materials.filter((material) => material.status === 'ready');

  const results = useQueries({
    queries: ready.map((material) => ({
      queryKey: queryKeys.progress(material.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getProgressOverview(material.id, signal),
    })),
  });

  const byMaterial = new Map<string, MaterialProgress>();

  ready.forEach((material, index) => {
    const overview = results[index]?.data;
    if (!overview) return;

    const withData = overview.masteryByTopic.filter(
      (topic) => topic.band !== 'insufficient_data',
    );

    byMaterial.set(material.id, {
      accuracy: overview.totals.accuracy,
      responseCount: overview.totals.responseCount,
      topicsMastered: withData.filter((topic) => topic.band === 'strong').length,
      weakestBand: weakestOf(withData.map((topic) => topic.band)),
      lastAnsweredAt: latestAnswer(overview.masteryByTopic.map((t) => t.lastAnsweredAt)),
    });
  });

  return {
    byMaterial,
    isPending: results.some((result) => result.isPending),
  };
}

/** Bands ordered worst first, so the first one present is the one to report. */
const WEAKEST_FIRST: MasteryBand[] = ['needs_attention', 'developing', 'strong'];

function weakestOf(bands: readonly MasteryBand[]): MasteryBand | null {
  return WEAKEST_FIRST.find((band) => bands.includes(band)) ?? null;
}

function latestAnswer(timestamps: readonly (string | null)[]): string | null {
  return timestamps.filter((value): value is string => Boolean(value)).sort().pop() ?? null;
}
