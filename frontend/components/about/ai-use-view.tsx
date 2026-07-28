'use client';

import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { ExternalIcon } from '@/components/ui/icons';
import { useAiDisclosure } from '@/lib/hooks/use-meta';

/**
 * Served from the API rather than written here, so the page cannot drift from
 * what the system actually runs.
 */
export function AiUseView() {
  const query = useAiDisclosure();

  return (
    <>
      <WorkspaceHeader
        title="How EducLM uses AI"
        subtitle="What each model does, and what it is not allowed to do"
        backHref="/"
        backLabel="Agent"
        showStatus={false}
      />

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-3 py-5 sm:px-5">
        <Card>
          <p className="text-ink">
            EducLM rewrites your own material into an accessible lesson, answers questions from
            it, and writes practice questions about it. It does not add facts of its own: every
            answer and every explanation carries the page it came from, so you can check it.
          </p>
          <p className="mt-3 text-ink">
            What EducLM knows about your learning is <strong>counted, not guessed</strong>. Mastery
            bands, repeated misconceptions and plan changes are computed from your recorded
            answers — no model decides you are weak at something.
          </p>
        </Card>

        {query.isPending ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={5} />
          </>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <Card>
              <CardHeader title="Models" />
              <ul className="m-0 list-none space-y-2">
                {query.data.models.map((model) => (
                  <li key={`${model.provider}-${model.model}`} className="rounded-md border border-line px-3 py-2.5">
                    <p className="font-medium text-ink">{model.purpose}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {model.provider} · {model.model}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Third-party libraries" />
              <ul className="m-0 list-none space-y-1.5">
                {query.data.libraries.map((library) => (
                  <li key={library.name} className="flex flex-wrap items-center gap-2 text-sm">
                    <a
                      href={library.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 font-medium text-ink underline decoration-lime decoration-2 underline-offset-2"
                    >
                      {library.name}
                      <ExternalIcon width="0.9em" height="0.9em" />
                    </a>
                    <span className="text-ink-muted">{library.license}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
