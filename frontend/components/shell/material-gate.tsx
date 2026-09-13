'use client';

import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorState, ScreenSkeleton } from '@/components/ui/states';
import { ProcessingStages, progressOf } from '@/components/upload/processing-stages';
import { useMaterial, useMaterialStatus } from '@/lib/hooks/use-materials';

/**
 * Holds a screen back until its material is actually ready.
 *
 * The plan, progress and analytics endpoints all build the learning plan on
 * first read. Reaching them before ingestion has produced any topics used to
 * persist an empty plan that nothing ever refilled — so the API now refuses,
 * and this is the screen that refusal deserves: what is happening, and how far
 * it has got, rather than an error the student has to retry by hand.
 *
 * The status poll runs while the material is being prepared and stops on its
 * own, so the screen fills in the moment the work finishes.
 */
export function MaterialGate({
  materialId,
  children,
  skeleton = 'stats',
}: {
  materialId: string;
  children: ReactNode;
  skeleton?: 'chat' | 'grid' | 'list' | 'stats';
}) {
  const material = useMaterial(materialId);

  // Only polled while there is something to wait for; a ready material makes no
  // requests here at all.
  const preparing = material.data ? material.data.status !== 'ready' : false;
  useMaterialStatus(materialId, preparing);

  if (material.isLoading) return <ScreenSkeleton variant={skeleton} className="p-0" />;

  if (material.isError) {
    return <ErrorState error={material.error} onRetry={() => void material.refetch()} />;
  }

  if (material.data?.status === 'failed') {
    return (
      <Card>
        <p className="text-sm text-attention">
          {material.data.failure?.message ?? 'That file could not be prepared.'}
        </p>
      </Card>
    );
  }

  if (material.data && material.data.status !== 'ready') {
    return (
      <Card>
        <ProcessingStages {...progressOf(material.data)} />
      </Card>
    );
  }

  return <>{children}</>;
}
