'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Material } from '@educlm/contracts';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { Card } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { MasteryPill } from '@/components/ui/chip';
import { ProgressBar } from '@/components/ui/charts';
import { ConfirmDialog } from '@/components/ui/sheet';
import { EmptyState, ErrorState, ScreenSkeleton } from '@/components/ui/states';
import { DocIcon, SearchIcon, TrashIcon, UploadIcon } from '@/components/ui/icons';
import { EduMascot } from '@/components/brand/edu-mascot';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useUploadDialog } from '@/components/upload/upload-dialog';
import { useDeleteMaterial } from '@/lib/hooks/use-materials';
import { useProgressOverview } from '@/lib/hooks/use-progress';
import { useMaterialsProgress, type MaterialProgress } from '@/lib/hooks/use-materials-progress';
import { MASTERY_BAR, percent, timeAgo } from '@/lib/format';
import { coverFor } from './cover';

/**
 * Course Explorer: the materials on this device and how far each has got.
 *
 * The mockup's marketplace columns — rating, enrolled students, subject
 * category, difficulty level — describe a catalogue this product does not
 * have. A material here is a PDF the student uploaded, so the columns are the
 * ones the API can actually answer: topics, answers given, mastery, recency.
 */
export function ExplorerView() {
  const { materials, setMaterialId, isLoading, error, refetch } = useCurrentMaterial();
  const [pendingDelete, setPendingDelete] = useState<Material | null>(null);
  const [query, setQuery] = useState('');
  const remove = useDeleteMaterial();
  const router = useRouter();
  const { openUpload } = useUploadDialog();
  const progress = useMaterialsProgress(materials);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? materials.filter((material) => material.title.toLowerCase().includes(needle))
    : materials;

  const open = (material: Material) => {
    setMaterialId(material.id);
    router.push('/');
  };

  return (
    <>
      <WorkspaceHeader
        title="Explore Courses"
        subtitle="Your materials, their skills, and how far you have got"
        actions={
          <Button variant="primary" size="sm" onClick={openUpload}>
            <UploadIcon />
            Add material
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-3 py-5 sm:px-5">
        {isLoading ? (
          <ScreenSkeleton variant="grid" className="p-0" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : materials.length === 0 ? (
          <EmptyState
            icon={<DocIcon />}
            title="Nothing here yet"
            description="Add a PDF module and it becomes a lesson you can read, question and practise."
            action={
              <Button variant="primary" onClick={openUpload}>
                Add your first material
              </Button>
            }
          />
        ) : (
          <>
            <section aria-labelledby="materials-heading">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
                <h2 id="materials-heading" className="font-display text-base font-bold text-ink">
                  Your materials
                </h2>
                <label className="flex min-h-9 min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 focus-within:border-nav sm:max-w-xs sm:flex-none">
                  <SearchIcon className="shrink-0 text-ink-subtle" />
                  <span className="sr-only">Search your materials</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search materials…"
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
                  />
                </label>
                <span className="text-xs text-ink-muted">
                  {visible.length} of {materials.length}{' '}
                  {materials.length === 1 ? 'material' : 'materials'}
                </span>
              </div>

              {visible.length === 0 ? (
                <p className="rounded-md border border-dashed border-line-strong bg-surface px-3 py-4 text-sm text-ink-muted">
                  No material matches that search.
                </p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
                  <ul className="m-0 grid list-none gap-3 sm:grid-cols-2">
                    {visible.map((material) => (
                      <li key={material.id}>
                        <MaterialCard
                          material={material}
                          progress={progress.byMaterial.get(material.id)}
                          onOpen={() => open(material)}
                          onDelete={() => setPendingDelete(material)}
                        />
                      </li>
                    ))}
                  </ul>

                  <EduTip />
                </div>
              )}
            </section>

            <MaterialsTable
              materials={visible}
              progress={progress.byMaterial}
              onOpen={open}
            />
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.title ?? 'this material'}?`}
        body="The material, its lessons, questions and your answer history are removed. This cannot be undone."
        destructive
        confirmLabel={remove.isPending ? 'Deleting…' : 'Delete material'}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

function MaterialCard({
  material,
  progress,
  onOpen,
  onDelete,
}: {
  material: Material;
  progress: MaterialProgress | undefined;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const ready = material.status === 'ready';
  const cover = coverFor(material.id);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      {/* Decoration, derived from the id so a material always looks the same.
          It carries no information and is hidden from assistive tech. */}
      <div aria-hidden="true" className="h-24 w-full" style={{ background: cover }} />

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-display text-sm font-bold text-ink">
            {material.title}
          </h3>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${material.title}`}
            className="shrink-0 rounded-sm p-1 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-attention"
          >
            <TrashIcon width="1em" height="1em" />
          </button>
        </div>

        <p className="text-xs text-ink-muted">
          {ready
            ? `${material.topicCount} topics · ${material.pageCount ?? 0} pages`
            : (material.processing?.message ?? 'Being prepared')}
        </p>

        {ready && progress && progress.responseCount > 0 ? (
          <>
            <div className="mt-auto flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <ProgressBar
                  value={progress.accuracy ?? 0}
                  label={`${material.title} accuracy`}
                  tone={progress.weakestBand ? MASTERY_BAR[progress.weakestBand] : 'neutral'}
                />
              </span>
              <span className="text-xs font-semibold tabular-nums text-ink">
                {percent(progress.accuracy)}
              </span>
            </div>
            {progress.weakestBand ? <MasteryPill band={progress.weakestBand} /> : null}
          </>
        ) : (
          <p className="mt-auto text-xs text-ink-subtle">
            {ready ? 'No answers yet' : 'Preparing…'}
          </p>
        )}

        <Button variant={ready ? 'primary' : 'outline'} size="sm" onClick={onOpen} full>
          {ready ? (progress?.responseCount ? 'Continue' : 'Start') : 'View progress'}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The mockup's "Tip from EDU". Here it is the real top finding for the open
 * material — the misconception the analytics engine actually detected, not a
 * recommendation invented to fill the card.
 */
function EduTip() {
  const { materialId } = useCurrentMaterial();
  const overview = useProgressOverview(materialId);
  const finding = overview.data?.topFinding ?? null;

  return (
    <Card className="h-fit border-lime bg-lime-soft">
      <div className="flex items-start gap-2.5">
        <EduMascot mood={finding ? 'wary' : 'default'} size={40} className="shrink-0" />
        <div className="min-w-0">
          <h3 className="font-display text-sm font-bold text-ink">Tip from EDU</h3>

          {finding ? (
            <>
              <p className="mt-1 text-xs leading-relaxed text-ink">
                {finding.label} keeps coming up in <strong>{finding.topicName}</strong> —{' '}
                {finding.occurrences} times in your last {finding.windowSize} answers.
              </p>
              <Link
                href={`/progress/${overview.data?.materialId ?? ''}`}
                prefetch={false}
                className="mt-2 inline-block text-xs font-semibold text-ink underline underline-offset-2"
              >
                See the evidence
              </Link>
            </>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-ink">
              Answer a few practice questions and I can point at the exact idea to work on next —
              with the answers that show it.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function MaterialsTable({
  materials,
  progress,
  onOpen,
}: {
  materials: readonly Material[];
  progress: ReadonlyMap<string, MaterialProgress>;
  onOpen: (material: Material) => void;
}) {
  return (
    <section aria-labelledby="all-materials-heading">
      <h2 id="all-materials-heading" className="mb-2.5 font-display text-base font-bold text-ink">
        All materials
      </h2>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken text-left">
              <Th>Material</Th>
              <Th align="right">Topics</Th>
              <Th align="right">Answered</Th>
              <Th>Progress</Th>
              <Th>Last studied</Th>
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {materials.map((material) => {
              const row = progress.get(material.id);
              const ready = material.status === 'ready';

              return (
                <tr key={material.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpen(material)}
                      className="text-left font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {material.title}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                    {ready ? material.topicCount : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                    {row?.responseCount ?? (ready ? 0 : '—')}
                  </td>
                  <td className="px-3 py-2.5">
                    {!ready ? (
                      <span className="text-xs text-ink-muted">
                        {material.status === 'failed' ? 'Failed' : 'Processing'}
                      </span>
                    ) : row && row.responseCount > 0 ? (
                      <span className="flex items-center gap-2">
                        <span className="min-w-[5rem] flex-1">
                          <ProgressBar
                            value={row.accuracy ?? 0}
                            label={`${material.title} accuracy`}
                            tone={row.weakestBand ? MASTERY_BAR[row.weakestBand] : 'neutral'}
                          />
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-ink">
                          {percent(row.accuracy)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-ink-subtle">No answers yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-muted">
                    {row?.lastAnsweredAt ? timeAgo(row.lastAnsweredAt) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => onOpen(material)}>
                      Open
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
