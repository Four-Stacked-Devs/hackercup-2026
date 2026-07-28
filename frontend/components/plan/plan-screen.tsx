'use client';

import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { useMaterial } from '@/lib/hooks/use-materials';
import { PlanView } from './plan-view';

export function PlanScreen({ materialId }: { materialId: string }) {
  const material = useMaterial(materialId);
  const title = material.data?.title ?? 'Your material';

  return (
    <>
      <WorkspaceHeader
        title="Learning plan"
        subtitle={material.data?.title ?? undefined}
        backHref="/"
        backLabel="Agent"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-5">
        <PlanView materialId={materialId} materialTitle={title} />
      </div>
    </>
  );
}
