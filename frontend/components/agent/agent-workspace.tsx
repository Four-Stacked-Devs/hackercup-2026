'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { PlanIcon, UploadIcon } from '@/components/ui/icons';
import { EduMascot } from '@/components/brand/edu-mascot';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SourceProvider } from '@/components/source/source-sheet';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useChatStream } from '@/lib/hooks/use-study';
import { useThreads } from '@/lib/hooks/use-threads';
import { findThread } from '@/lib/threads';
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

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={5} />
      </div>
    );
  }

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
              <ButtonLink variant="outline" size="sm" className="mt-3" href="/upload">
                Watch it being prepared
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

  const { threads, record, isPending, isError, error, refetch } = useThreads(materialId);
  const thread = findThread(threads, activeTopicId);

  const stream = useChatStream(materialId, {
    onAssistantMessage: useCallback(
      (message: { id: string }, topicId: string | null) => record(topicId, [message.id]),
      [record],
    ),
  });

  const setTopic = (topicId: string | null) =>
    router.replace(topicId ? `/?topic=${topicId}` : '/');

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
              onAsk={(message) => stream.send(message, activeTopicId ?? undefined)}
              busy={stream.isStreaming}
            />
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <Composer
          onSend={(message) => stream.send(message, activeTopicId ?? undefined)}
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
            <ButtonLink href="/upload" variant="primary" size="lg" full>
              <UploadIcon />
              Upload material and build a study plan
            </ButtonLink>
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
