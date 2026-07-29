'use client';

import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { useMaterial } from '@/lib/hooks/use-materials';
import { AnalyticsView } from './analytics-view';

export function AnalyticsScreen({ materialId }: { materialId: string }) {
  const material = useMaterial(materialId);

  return (
    <>
      <WorkspaceHeader
        title="Learning Analytics"
        subtitle={material.data?.title ?? undefined}
        backHref="/"
        backLabel="Agent"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-5">
        <AnalyticsView materialId={materialId} />
      </div>
    </>
  );
}
