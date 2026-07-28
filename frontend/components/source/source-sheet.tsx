'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Citation } from '@educlm/contracts';
import { useMaterialPage } from '@/lib/hooks/use-study';
import { usePreferences } from '@/components/providers/preferences-provider';
import { Sheet } from '@/components/ui/sheet';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { cn } from '@/lib/cn';

interface SourceContextValue {
  open: (page: number) => void;
}

const SourceContext = createContext<SourceContextValue | null>(null);

/**
 * "Compare with the source" is one shared sheet: a citation anywhere — lesson,
 * answer, feedback, evidence trail — opens the same original page.
 */
export function SourceProvider({
  materialId,
  children,
}: {
  materialId: string | null;
  children: ReactNode;
}) {
  const [page, setPage] = useState<number | null>(null);
  const open = useCallback((next: number) => setPage(next), []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <SourceContext.Provider value={value}>
      {children}
      <SourcePageSheet
        materialId={materialId}
        page={page}
        onClose={() => setPage(null)}
      />
    </SourceContext.Provider>
  );
}

function useSourceViewer(): SourceContextValue | null {
  return useContext(SourceContext);
}

function SourcePageSheet({
  materialId,
  page,
  onClose,
}: {
  materialId: string | null;
  page: number | null;
  onClose: () => void;
}) {
  const { preferences } = usePreferences();
  const query = useMaterialPage(materialId, page);

  return (
    <Sheet
      open={page !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={page ? `Original page ${page}` : 'Original page'}
      description="The text as it appears in your material."
      side="bottom"
    >
      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data && query.data.text.trim().length > 0 ? (
        <>
          {query.data.imageUrl && !preferences.lowDataMode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={query.data.imageUrl}
              alt={`Scan of page ${query.data.page}`}
              className="mb-4 w-full rounded-md border border-line"
            />
          ) : null}
          <p className="whitespace-pre-wrap font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-sm leading-relaxed text-ink">
            {query.data.text}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">
          This page has no text to show — it may be a cover, a divider or an image.
        </p>
      )}
    </Sheet>
  );
}

/** `p. 27 →` — the tappable link back to where an answer came from. */
export function CitationChip({
  citation,
  className,
}: {
  citation: Citation;
  className?: string;
}) {
  const viewer = useSourceViewer();
  const label = citation.sectionTitle
    ? `p. ${citation.page} · ${citation.sectionTitle}`
    : `p. ${citation.page}`;

  return (
    <button
      type="button"
      onClick={() => viewer?.open(citation.page)}
      disabled={!viewer}
      title={citation.snippet}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink hover:border-lime hover:bg-lime-soft disabled:opacity-60',
        className,
      )}
    >
      <span className="truncate">{label}</span>
      <span aria-hidden="true">→</span>
      <span className="sr-only">Open the original page {citation.page}</span>
    </button>
  );
}

/** A page reference on a lesson section or a question. */
export function PageRef({ page, className }: { page: number; className?: string }) {
  const viewer = useSourceViewer();

  return (
    <button
      type="button"
      onClick={() => viewer?.open(page)}
      disabled={!viewer}
      className={cn(
        'rounded-sm px-1 text-xs text-ink-muted underline decoration-lime decoration-2 underline-offset-2 hover:text-ink disabled:no-underline',
        className,
      )}
    >
      p. {page}
      <span className="sr-only"> — open the original page</span>
    </button>
  );
}
