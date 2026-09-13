'use client';

import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { MaterialGate } from '@/components/shell/material-gate';
import { useMaterial } from '@/lib/hooks/use-materials';
import { PlanView } from './plan-view';

export function PlanScreen({ materialId }: { materialId: string }) {
  const material = useMaterial(materialId);
  const title = material.data?.title ?? 'Your material';

  return (
    <>
      <WorkspaceHeader
        title="Your Learning Plan"
        subtitle="A study plan generated with EDU, adapted as you practise"
        backHref="/"
        backLabel="Agent"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-5">
        <MaterialGate materialId={materialId} skeleton="list">
          <PlanView materialId={materialId} materialTitle={title} />
        </MaterialGate>
      </div>
    </>
  );
}
