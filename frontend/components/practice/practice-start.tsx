'use client';

import { useRouter } from 'next/navigation';
import type { PracticeSetKind } from '@educlm/contracts';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { MasteryPill } from '@/components/ui/chip';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useUploadDialog } from '@/components/upload/upload-dialog';
import { useTopics } from '@/lib/hooks/use-study';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';

/** Where the sidebar's Practice item lands: pick the scope, then start. */
export function PracticeStart() {
  const router = useRouter();
  const { material } = useCurrentMaterial();
  const { openUpload } = useUploadDialog();
  const topics = useTopics(material?.id ?? null);
  const createSet = useCreatePracticeSet();

  const start = (kind: PracticeSetKind, topicId?: string) => {
    if (!material) return;
    createSet.mutate(
      { materialId: material.id, kind, ...(topicId ? { topicId } : {}), count: 5 },
      { onSuccess: (set) => router.push(`/practice/${set.id}`) },
    );
  };

  return (
    <>
      <WorkspaceHeader
        title="Practice"
        subtitle={material?.title ?? undefined}
        backHref="/"
        backLabel="Agent"
      />

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-3 py-5 sm:px-5">
        {!material ? (
          <EmptyState
            title="Nothing to practise yet"
            description="Add a PDF module and EducLM will build questions from it, one at a time, with the source page behind every answer."
            action={<Button variant="primary" onClick={openUpload}>Add a material</Button>}
          />
        ) : (
          <>
            <Card>
              <CardHeader
                title="Whole material"
                description="Five questions across every topic, to see where you stand."
              />
              <Button
                variant="primary"
                onClick={() => start('diagnostic')}
                disabled={createSet.isPending}
              >
                {createSet.isPending ? 'Building your questions…' : 'Start a diagnostic set'}
              </Button>
            </Card>

            <Card>
              <CardHeader title="One topic" description="Focused practice on what you choose." />

              {topics.isPending ? (
                <SkeletonCard lines={4} />
              ) : topics.isError ? (
                <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />
              ) : (
                <ul className="m-0 list-none space-y-2">
                  {(topics.data ?? []).map((topic) => (
                    <li
                      key={topic.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{topic.name}</span>
                        <span className="text-xs text-ink-muted">
                          {topic.questionCount} questions available
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {topic.mastery ? <MasteryPill band={topic.mastery.band} /> : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => start('focused', topic.id)}
                          disabled={createSet.isPending || topic.questionCount === 0}
                        >
                          Practise
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Try again"
                description="Only the questions you have answered incorrectly."
              />
              <Button variant="outline" onClick={() => start('retry')} disabled={createSet.isPending}>
                Start a retry set
              </Button>
            </Card>
          </>
        )}

        {createSet.isError ? (
          <ErrorState error={createSet.error} onRetry={() => start('diagnostic')} />
        ) : null}
      </div>
    </>
  );
}
