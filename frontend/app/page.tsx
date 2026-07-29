import { Suspense } from 'react';
import { AgentWorkspace } from '@/components/agent/agent-workspace';
import { SkeletonCard } from '@/components/ui/states';

export default function AgentPage() {
  return (
    // The open thread is read from the query string, which needs a boundary.
    <Suspense
      fallback={
        <div className="space-y-3 p-4">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </div>
      }
    >
      <AgentWorkspace />
    </Suspense>
  );
}
