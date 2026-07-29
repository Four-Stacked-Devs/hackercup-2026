'use client';

import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SourceProvider } from '@/components/source/source-sheet';
import { useMaterial } from '@/lib/hooks/use-materials';
import { ProgressView } from './progress-view';

export function ProgressScreen({ materialId }: { materialId: string }) {
  const material = useMaterial(materialId);

  return (
    <SourceProvider materialId={materialId}>
      <WorkspaceHeader
        title="Your Progress"
        subtitle={material.data?.title ?? undefined}
        backHref="/"
        backLabel="Agent"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-5">
        <ProgressView materialId={materialId} />
      </div>
    </SourceProvider>
  );
}
