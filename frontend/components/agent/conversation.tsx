'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@educlm/contracts';
import { Markdown } from '@/components/ui/markdown';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { CheckIcon, WorkingDots } from '@/components/ui/icons';
import { CitationChip } from '@/components/source/source-sheet';
import { EduMascot } from '@/components/brand/edu-mascot';
import { clockTime } from '@/lib/format';
import type { StreamingAnswer } from '@/lib/hooks/use-study';

/**
 * The conversation: your turn on the right in a plain bubble, EDU's turn on the
 * left behind the mascot, and the sources under every answer.
 */
export function Conversation({
  messages,
  isPending,
  isError,
  error,
  onRetry,
  pendingQuestion,
  answer,
  streamError,
  emptyState,
}: {
  messages: ChatMessage[];
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  pendingQuestion: string | null;
  answer: StreamingAnswer | null;
  streamError: string | null;
  emptyState?: React.ReactNode;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, answer?.content, pendingQuestion]);

  if (isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading the conversation">
        <Skeleton className="h-14 w-3/4" />
        <Skeleton className="ml-auto h-20 w-4/5" />
      </div>
    );
  }

  if (isError) return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;

  const empty = messages.length === 0 && !pendingQuestion;

  return (
    <div className="space-y-4">
      {empty ? emptyState : null}

      {messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}

      {pendingQuestion ? (
        <MessageRow
          message={{
            id: 'pending-user',
            role: 'user',
            content: pendingQuestion,
            citations: [],
            createdAt: new Date().toISOString(),
          }}
        />
      ) : null}

      {answer ? <StreamingRow answer={answer} /> : null}

      {streamError ? <ErrorState error={new Error(streamError)} /> : null}

      <div ref={endRef} />
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="max-w-[85%] min-w-0">
          <p className="mb-1 text-right text-xs text-ink-subtle">
            You · {clockTime(message.createdAt)}
          </p>
          <div className="rounded-lg rounded-tr-sm border border-line bg-lime-soft px-3 py-2 text-sm text-ink">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="flex gap-2.5">
      <EduMascot size={28} className="mt-5" />

      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-baseline gap-2 text-xs text-ink-subtle">
          <span className="font-display text-sm font-bold text-ink">EDU</span>
          <span>{clockTime(message.createdAt)}</span>
        </p>

        <div className="rounded-lg rounded-tl-sm border border-line bg-surface px-3 py-2 text-ink">
          <Markdown className="prose-compact">{message.content}</Markdown>

          {message.citations.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              <span className="sr-only">Sources for this answer</span>
              {message.citations.map((citation) => (
                <CitationChip key={`${citation.chunkId}-${citation.page}`} citation={citation} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StreamingRow({ answer }: { answer: StreamingAnswer }) {
  return (
    <article className="flex gap-2.5">
      <EduMascot mood="thinking" size={28} className="mt-5" />
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-baseline gap-2 text-xs text-ink-subtle">
          <span className="font-display text-sm font-bold text-ink">EDU</span>
          <span>now</span>
        </p>

        <div className="rounded-lg rounded-tl-sm border border-line bg-surface px-3 py-2">
          <div aria-live="polite" aria-busy="true">
            {answer.content ? (
              <Markdown className="prose-compact">{answer.content}</Markdown>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <WorkingDots className="text-ink" />
                Looking through your material
              </p>
            )}
          </div>

          {answer.citations.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              {answer.citations.map((citation) => (
                <CitationChip key={`${citation.chunkId}-${citation.page}`} citation={citation} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * What the request is actually doing, step by step. The labels are true rather
 * than theatrical — these are the stages the stream goes through.
 */
export function AgentWorking({ answer }: { answer: StreamingAnswer | null }) {
  if (!answer) return null;

  const steps = [
    { label: 'Searching your material', done: true },
    { label: 'Reading the matching pages', done: answer.content.length > 0 },
    { label: 'Writing the answer with sources', done: answer.citations.length > 0 },
  ];

  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5" aria-label="What the agent is doing">
      {steps.map((step) => (
        <li
          key={step.label}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-muted"
        >
          {step.done ? (
            <CheckIcon width="0.9em" height="0.9em" className="text-strong" />
          ) : (
            <WorkingDots className="text-ink" />
          )}
          {step.label}
        </li>
      ))}
    </ul>
  );
}
