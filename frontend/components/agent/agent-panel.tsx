'use client';

import { useChatMessages, useChatStream } from '@/lib/hooks/use-study';
import { EmptyState } from '@/components/ui/states';
import { Conversation, AgentWorking } from './conversation';
import { Composer } from './composer';

/**
 * The agent beside the reader: a column on desktop, a sheet on a phone. Same
 * component either way, so the conversation survives the switch.
 */
export function AgentPanel({
  materialId,
  topicId,
  heading = 'Ask about this material',
}: {
  materialId: string;
  topicId?: string | null;
  heading?: string;
}) {
  const history = useChatMessages(materialId);
  const stream = useChatStream(materialId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2.5 sm:px-4">
        <h2 className="font-display text-sm font-bold text-ink">{heading}</h2>
        <p className="text-xs text-ink-muted">
          Every answer cites the page it came from.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        <Conversation
          messages={history.data ?? []}
          isPending={history.isPending}
          isError={history.isError}
          error={history.error}
          onRetry={() => void history.refetch()}
          pendingQuestion={stream.pendingQuestion}
          answer={stream.answer}
          streamError={stream.error}
          emptyState={
            <EmptyState
              title="Ask anything about this material"
              description="EducLM only answers from what you uploaded, and shows you the page behind every answer."
            />
          }
        />

        {stream.answer ? (
          <div className="mt-3">
            <AgentWorking answer={stream.answer} />
          </div>
        ) : null}
      </div>

      <Composer
        onSend={(message) => stream.send(message, topicId ?? undefined)}
        busy={stream.isStreaming}
        topicId={topicId ?? null}
        showContext={false}
      />
    </div>
  );
}
