'use client';

import { useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorState, ScreenSkeleton } from '@/components/ui/states';
import { PlanIcon, UploadIcon } from '@/components/ui/icons';
import { EduMascot } from '@/components/brand/edu-mascot';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SourceProvider } from '@/components/source/source-sheet';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useUploadDialog } from '@/components/upload/upload-dialog';
import { useChatStream } from '@/lib/hooks/use-study';
import { useThreads } from '@/lib/hooks/use-threads';
import { findThread, findThreadByKey } from '@/lib/threads';
import { newConversationId } from '@/lib/thread-index';
import { Conversation, AgentWorking } from './conversation';
import { Composer } from './composer';
import { ActionChips } from './action-chips';
import { Greeting } from './greeting';

/**
 * Home is the conversation. The plan, practice, progress and the material
 * itself are opened from it — from an action under an answer, or from the rail.
 *
 * Which thread is open lives in the query string (`?topic=`), so a thread is
 * linkable and the back button behaves.
 */
export function AgentWorkspace() {
  const { material, materials, isLoading, error, refetch } = useCurrentMaterial();

  if (isLoading) return <ScreenSkeleton variant="chat" />;

  if (error) {
    return (
      <div className="p-4">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  if (materials.length === 0 || !material) return <FirstRun />;

  const processing = material.status !== 'ready';

  return (
    <SourceProvider materialId={material.id}>
      {processing ? (
        <>
          <WorkspaceHeader title={material.title} subtitle="Still being prepared" />
          <div className="p-4">
            <Card>
              <p className="text-sm text-ink">
                EDU is still reading {material.title}. The agent can answer once it is ready.
              </p>
              <ButtonLink variant="outline" size="sm" className="mt-3" href="/materials">
                See its progress
              </ButtonLink>
            </Card>
          </div>
        </>
      ) : (
        <ConversationColumn materialId={material.id} materialTitle={material.title} />
      )}
    </SourceProvider>
  );
}

function ConversationColumn({
  materialId,
  materialTitle,
}: {
  materialId: string;
  materialTitle: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTopicId = searchParams.get('topic');
  // Plain `/` is a fresh start — the logo and New Chat always land on the
  // greeting. `?thread=all` is the pre-existing untopiced log; `?thread=conv-…`
  // is one conversation started from that greeting.
  const activeThreadKey = searchParams.get('thread');

  const { threads, record, recordConversation, isPending, isError, error, refetch } =
    useThreads(materialId);

  const thread = activeTopicId
    ? findThread(threads, activeTopicId)
    : activeThreadKey === 'all'
      ? findThread(threads, null)
      : activeThreadKey
        ? findThreadByKey(threads, activeThreadKey)
        : undefined;

  /**
   * Which thread the in-flight message belongs to, decided at send time.
   *
   * It cannot be decided on arrival: by then the greeting has been replaced and
   * there is no longer anything to distinguish "this began a new conversation"
   * from "this continued the open one". Sending from the greeting mints an id,
   * so a new chat never lands in the shared untopiced thread — which is exactly
   * what made previous messages appear the moment you sent one.
   */
  const pendingConversationRef = useRef<string | null>(null);

  const stream = useChatStream(materialId, {
    onAssistantMessage: useCallback(
      (message: { id: string }, topicId: string | null) => {
        const conversationId = pendingConversationRef.current;
        pendingConversationRef.current = null;

        if (conversationId) {
          recordConversation(conversationId, [message.id]);
          // Follow the answer into its own conversation, so the settled reply
          // stays on screen and the sidebar row is the one now open.
          router.replace(`/?thread=${conversationId}`);
          return;
        }

        record(topicId, [message.id]);
        if (!topicId) router.replace('/?thread=all');
      },
      [record, recordConversation, router],
    ),
  });

  /** Stamps the in-flight message with its thread, then sends it. */
  const send = (message: string, topicId?: string) => {
    pendingConversationRef.current =
      activeTopicId || activeThreadKey === 'all'
        ? // An open topic thread, or the legacy untopiced log: append to it.
          null
        : (activeThreadKey ?? newConversationId());

    stream.send(message, topicId);
  };

  const setTopic = (topicId: string | null) =>
    router.replace(topicId ? `/?topic=${topicId}` : '/?thread=all');

  const messages = thread?.messages ?? [];
  const lastIsAnswer = messages[messages.length - 1]?.role === 'assistant';

  return (
    <>
      <WorkspaceHeader
        title={thread ? thread.title : materialTitle}
        subtitle={activeTopicId ? materialTitle : 'All topics'}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <Conversation
            messages={messages}
            isPending={isPending}
            isError={isError}
            error={error}
            onRetry={refetch}
            pendingQuestion={stream.pendingQuestion}
            answer={stream.answer}
            streamError={stream.error}
            emptyState={<Greeting />}
          />

          {stream.answer ? <AgentWorking answer={stream.answer} /> : null}

          {lastIsAnswer && !stream.answer ? (
            <ActionChips
              materialId={materialId}
              topicId={activeTopicId}
              onAsk={(message) => send(message, activeTopicId ?? undefined)}
              busy={stream.isStreaming}
            />
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <Composer
          onSend={(message) => send(message, activeTopicId ?? undefined)}
          busy={stream.isStreaming}
          topicId={activeTopicId}
          onTopicChange={setTopic}
        />
      </div>
    </>
  );
}

/** Nothing uploaded yet: an invitation, not a shrug. */
function FirstRun() {
  const { openUpload } = useUploadDialog();

  return (
    <>
      <WorkspaceHeader title="EducLM" subtitle="One agent. Your goals. Every step." />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg text-center">
          <EduMascot size={104} eager className="mx-auto mb-4" />
          <h2 className="font-display text-2xl font-bold text-ink">
            Hi, I&apos;m EDU. What are we studying?
          </h2>
          <p className="mx-auto mt-2 max-w-[52ch] text-sm text-ink-muted">
            Add a PDF module and I turn it into a lesson you can read, question and practise — with
            the original page behind every answer.
          </p>

          <div className="mt-5 grid gap-2 text-left">
            <Button variant="primary" size="lg" full onClick={openUpload}>
              <UploadIcon />
              Upload material and build a study plan
            </Button>
            <ButtonLink href="/materials" variant="outline" size="lg" full>
              <PlanIcon />
              Open the sample module
            </ButtonLink>
          </div>
        </div>
      </div>
    </>
  );
}
