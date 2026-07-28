'use client';

import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SourceProvider } from '@/components/source/source-sheet';
import { usePracticeSet } from '@/lib/hooks/use-practice';
import { PracticeRunner } from './practice-runner';

export function PracticeScreen({ setId }: { setId: string }) {
  const set = usePracticeSet(setId);
  const materialId = set.data?.materialId ?? null;

  return (
    <SourceProvider materialId={materialId}>
      <WorkspaceHeader
        title={set.data?.kind === 'focused' ? 'Focused practice' : 'Practice'}
        subtitle={set.data?.topicName ?? undefined}
        backHref={materialId ? `/progress/${materialId}` : '/practice'}
        backLabel="Back"
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-5">
        <PracticeRunner setId={setId} />
      </div>
    </SourceProvider>
  );
}
