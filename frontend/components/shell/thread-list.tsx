'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { filterThreads, type ChatThread } from '@/lib/threads';
import { useThreadGroups } from '@/lib/hooks/use-threads';
import { SearchIcon } from '@/components/ui/icons';

interface ThreadListProps {
  threads: readonly ChatThread[];
  /** The topic currently open in the workspace, if any. */
  activeTopicId: string | null;
  /** The conversation currently open (`/?thread=conv-…`), if any. */
  activeThreadKey?: string | null;
  /** Whether the untopiced thread (`/?thread=all`) is the one open. */
  ungroupedOpen: boolean;
  isPending: boolean;
  /** The conversation log could not be loaded. */
  isError?: boolean;
  onRetry?: () => void;
  /** False when no material is selected, so there is nothing to have chats in. */
  hasMaterial?: boolean;
}

/** Topic threads open by topic; conversations by their own key. */
function hrefFor(thread: ChatThread): string {
  if (thread.topicId) return `/?topic=${thread.topicId}`;
  if (thread.conversationId) return `/?thread=${thread.conversationId}`;
  return '/?thread=all';
}

/**
 * The conversation history in the rail.
 *
 * Threads are grouped by topic and headed by recency. The topic association is
 * recorded locally (see `lib/thread-index.ts`), so anything this browser did
 * not send appears in the ungrouped thread rather than being dropped.
 */
export function ThreadList({
  threads,
  activeTopicId,
  activeThreadKey = null,
  ungroupedOpen,
  isPending,
  isError = false,
  onRetry,
  hasMaterial = true,
}: ThreadListProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const visible = useMemo(() => filterThreads(threads, query), [threads, query]);
  const groups = useThreadGroups(visible);

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-nav-ink-muted">
          Chat History
        </h2>
        <button
          type="button"
          onClick={() => setSearching((open) => !open)}
          aria-expanded={searching}
          aria-label={searching ? 'Hide chat search' : 'Search chats'}
          className="rounded-sm p-1 text-nav-ink-muted transition-colors hover:bg-nav-raised hover:text-nav-ink"
        >
          <SearchIcon />
        </button>
      </div>

      {searching ? (
        <div className="px-2.5 pb-2">
          <input
            type="search"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full rounded-md border border-white/15 bg-nav-raised px-2.5 py-1.5 text-sm text-nav-ink placeholder:text-nav-ink-muted focus-visible:border-lime focus-visible:outline-none"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <ul className="space-y-1 px-2.5 py-1">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-8 animate-pulse rounded-md bg-nav-raised" />
            ))}
          </ul>
        ) : isError ? (
          /*
            A failed log used to fall through to "No conversations yet", which
            reads as "you have never chatted" when the truth is that the request
            did not come back. Losing history is alarming; say what happened.
          */
          <div className="px-2.5 py-2">
            <p className="text-xs leading-relaxed text-nav-ink-muted">
              Your chats could not be loaded. They are safe on the server.
            </p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1.5 rounded-sm text-xs font-semibold text-lime underline-offset-2 hover:underline"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2.5 py-2 text-xs leading-relaxed text-nav-ink-muted">
            {query
              ? 'No chats match that search.'
              : hasMaterial
                ? 'No conversations yet. Ask EDU something to start one.'
                : 'Add a PDF to start your first conversation.'}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.bucket} className="pb-1.5">
              <h3 className="px-2.5 py-1 text-xs font-medium text-nav-ink-muted">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.threads.map((thread) => (
                  <ThreadRow
                    key={thread.key}
                    thread={thread}
                    active={
                      thread.topicId
                        ? thread.topicId === activeTopicId
                        : thread.conversationId
                          ? thread.conversationId === activeThreadKey
                          : ungroupedOpen
                    }
                    onOpen={() => router.push(hrefFor(thread))}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onOpen,
}: {
  thread: ChatThread;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        title={thread.preview}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
          active ? 'bg-nav-raised font-medium text-white' : 'text-nav-ink hover:bg-nav-raised',
        )}
      >
        <span className="truncate">{thread.title}</span>
      </button>
    </li>
  );
}
