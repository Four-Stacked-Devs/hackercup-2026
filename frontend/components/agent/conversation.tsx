'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@educlm/contracts';
import { Markdown } from '@/components/ui/markdown';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { CheckIcon, CopyIcon, WorkingDots } from '@/components/ui/icons';
import { CitationChip } from '@/components/source/source-sheet';
import { EduMascot } from '@/components/brand/edu-mascot';
import { clockTime } from '@/lib/format';
import type { StreamingAnswer } from '@/lib/hooks/use-study';

/**
 * The conversation.
 *
 * Your turn is a grey pill on the right. EDU's turn is plain prose on the left
 * behind the mascot — no card around it, so the answer reads as text rather
 * than as a component, and any structure inside it (a table, a worked example)
 * supplies its own frame. Sources sit under the answer they belong to.
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
    <div className="space-y-6">
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
  if (message.role === 'user') {
    return (
      <article className="flex justify-end">
        <div className="min-w-0 max-w-[80%]">
          <p className="rounded-2xl bg-surface-sunken px-4 py-2.5 text-sm leading-relaxed text-ink">
            <span className="sr-only">You said at {clockTime(message.createdAt)}: </span>
            <span className="whitespace-pre-wrap">{message.content}</span>
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="flex gap-3">
      <EduMascot size={30} className="mt-0.5 shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="sr-only">EDU said at {clockTime(message.createdAt)}:</p>
        <Markdown className="prose-compact text-ink">{message.content}</Markdown>

        {message.citations.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="sr-only">Sources for this answer</span>
            {message.citations.map((citation) => (
              <CitationChip key={`${citation.chunkId}-${citation.page}`} citation={citation} />
            ))}
          </div>
        ) : null}

        <CopyAnswerButton content={message.content} />
      </div>
    </article>
  );
}

/**
 * The mockup's answer-footer row, reduced to the one control with something
 * behind it. Thumbs up/down have no endpoint, so they are not drawn.
 */
function CopyAnswerButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard needs a secure context; without one the button does nothing
      // rather than pretending it worked.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-xs text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {copied ? <CheckIcon width="1em" height="1em" className="text-strong" /> : <CopyIcon width="1em" height="1em" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function StreamingRow({ answer }: { answer: StreamingAnswer }) {
  return (
    <article className="flex gap-3">
      <EduMascot mood="thinking" size={30} className="mt-0.5 shrink-0" />

      <div className="min-w-0 flex-1">
        <div aria-live="polite" aria-busy="true">
          {answer.content ? (
            <Markdown className="prose-compact text-ink">{answer.content}</Markdown>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <WorkingDots className="text-ink" />
              Looking through your material
            </p>
          )}
        </div>

        {answer.citations.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {answer.citations.map((citation) => (
              <CitationChip key={`${citation.chunkId}-${citation.page}`} citation={citation} />
            ))}
          </div>
        ) : null}
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
