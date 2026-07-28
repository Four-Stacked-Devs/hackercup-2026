'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Material } from '@educlm/contracts';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, ButtonLink, NotBuiltButton } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ConfirmDialog } from '@/components/ui/sheet';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';
import { DocIcon, TrashIcon, UploadIcon } from '@/components/ui/icons';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useDeleteMaterial } from '@/lib/hooks/use-materials';
import { timeAgo } from '@/lib/format';

/** The wireframe's Library: everything this device has uploaded. */
export function LibraryView() {
  const { materials, material, setMaterialId, isLoading, error, refetch } = useCurrentMaterial();
  const [pendingDelete, setPendingDelete] = useState<Material | null>(null);
  const remove = useDeleteMaterial();
  const router = useRouter();

  return (
    <>
      <WorkspaceHeader
        title="Library"
        subtitle="Materials on this device"
        backHref="/"
        backLabel="Agent"
        actions={
          <ButtonLink href="/upload" variant="primary" size="sm">
            <UploadIcon />
            Add material
          </ButtonLink>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-3 py-5 sm:px-5">
        {isLoading ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </>
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : materials.length === 0 ? (
          <EmptyState
            icon={<DocIcon />}
            title="Your library is empty"
            description="Add a PDF module and it becomes a lesson you can read, question and practise."
            action={
              <ButtonLink href="/upload" variant="primary">
                Add your first material
              </ButtonLink>
            }
          />
        ) : (
          materials.map((entry) => (
            <Card key={entry.id} className="p-3">
              <CardHeader
                title={entry.title}
                description={`${entry.originalFilename} · added ${timeAgo(entry.createdAt)}`}
                level={3}
                action={entry.id === material?.id ? <Chip tone="lime">In context</Chip> : null}
              />

              <div className="flex flex-wrap items-center gap-1.5">
                {entry.status === 'ready' ? (
                  <>
                    <Chip tone="neutral">
                      {entry.pageCount ?? 0} pages · {entry.topicCount} topics
                    </Chip>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setMaterialId(entry.id);
                        router.push(`/study/${entry.id}`);
                      }}
                    >
                      Open
                    </Button>
                    <ButtonLink variant="outline" size="sm" href={`/progress/${entry.id}`}>
                      Progress
                    </ButtonLink>
                  </>
                ) : entry.status === 'failed' ? (
                  <Chip tone="attention">
                    {entry.failure?.message ?? 'This material could not be prepared'}
                  </Chip>
                ) : (
                  <>
                    <Chip tone="ink">
                      {entry.processing?.message ?? 'Preparing'} · {entry.processing?.percent ?? 0}%
                    </Chip>
                    <ButtonLink variant="outline" size="sm" href="/upload">
                      Watch progress
                    </ButtonLink>
                  </>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-attention"
                  onClick={() => setPendingDelete(entry)}
                  disabled={remove.isPending}
                >
                  <TrashIcon />
                  Delete
                </Button>
              </div>
            </Card>
          ))
        )}

        {remove.isError ? <ErrorState error={remove.error} /> : null}

        <Card>
          <CardHeader
            title="Saved notes and clips"
            description="The wireframe's saved-items shelf. No endpoint backs it in this build, so it is switched off rather than faked."
          />
          <NotBuiltButton label="Saved items">
            <DocIcon />
            Saved items
          </NotBuiltButton>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.title ?? 'this material'}?`}
        body="The file, its lesson, its questions and everything EducLM learned from your answers on it are removed. This cannot be undone."
        confirmLabel="Delete it"
        destructive
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
