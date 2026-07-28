'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Topic } from '@educlm/contracts';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/charts';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { AgentIcon, MenuIcon } from '@/components/ui/icons';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SourceProvider } from '@/components/source/source-sheet';
import { AgentPanel } from '@/components/agent/agent-panel';
import { useLesson, useTopics } from '@/lib/hooks/use-study';
import { useMaterial } from '@/lib/hooks/use-materials';
import { cn } from '@/lib/cn';
import { MASTERY_BAR, MASTERY_LABEL } from '@/lib/format';
import { LessonView } from './lesson-view';

/**
 * A reader with an assistant, not a chat with a document attached: the lesson
 * holds the middle of the screen at every width.
 */
export function StudyView({ materialId }: { materialId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTopic = searchParams.get('topicId');

  const material = useMaterial(materialId);
  const topics = useTopics(materialId);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  const topicId = useMemo(() => {
    const list = topics.data ?? [];
    if (requestedTopic && list.some((topic) => topic.id === requestedTopic)) return requestedTopic;
    return list[0]?.id ?? null;
  }, [requestedTopic, topics.data]);

  const lesson = useLesson(materialId, topicId);

  // Opening a topic closes the sheet it was chosen from.
  useEffect(() => setTopicsOpen(false), [topicId]);

  const selectTopic = (id: string) => {
    router.replace(`/study/${materialId}?topicId=${encodeURIComponent(id)}`, { scroll: false });
  };

  return (
    <SourceProvider materialId={materialId}>
      <WorkspaceHeader
        title={material.data?.title ?? 'Study'}
        subtitle={
          topics.data ? `${topics.data.length} topics · ${material.data?.pageCount ?? 0} pages` : undefined
        }
        backHref="/"
        backLabel="Agent"
        actions={
          <span className="flex gap-1.5 lg:hidden">
            <Button variant="outline" size="sm" onClick={() => setTopicsOpen(true)}>
              <MenuIcon />
              Topics
            </Button>
            <Button variant="primary" size="sm" onClick={() => setAgentOpen(true)}>
              <AgentIcon />
              Ask
            </Button>
          </span>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-[240px] shrink-0 overflow-y-auto border-r border-line bg-surface px-3 py-4 lg:block"
          aria-label="Topics"
        >
          <TopicList
            topics={topics.data ?? []}
            isPending={topics.isPending}
            isError={topics.isError}
            error={topics.error}
            onRetry={() => void topics.refetch()}
            selectedId={topicId}
            onSelect={selectTopic}
          />
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-[70ch]">
            {topics.data && topics.data.length === 0 ? (
              <EmptyState
                title="No topics in this material yet"
                description="EducLM finds topics while it reads a material. If this stays empty, the file may not have had readable text."
              />
            ) : (
              <LessonView
                lesson={lesson.data}
                isPending={lesson.isPending}
                isError={lesson.isError}
                error={lesson.error}
                onRetry={() => void lesson.refetch()}
              />
            )}
          </div>
        </div>

        <aside
          className="hidden w-[380px] shrink-0 flex-col border-l border-line bg-surface xl:flex"
          aria-label="Agent"
        >
          <AgentPanel materialId={materialId} topicId={topicId} />
        </aside>
      </div>

      <Sheet
        open={topicsOpen}
        onOpenChange={setTopicsOpen}
        title="Topics"
        description="Pick what to read next."
      >
        <TopicList
          topics={topics.data ?? []}
          isPending={topics.isPending}
          isError={topics.isError}
          error={topics.error}
          onRetry={() => void topics.refetch()}
          selectedId={topicId}
          onSelect={selectTopic}
        />
      </Sheet>

      {/* ~70% height, so the lesson stays visible above the agent. */}
      <div className="xl:hidden">
        <Sheet
          open={agentOpen}
          onOpenChange={setAgentOpen}
          title="Ask EducLM"
          description="Answers come from this material, with the page attached."
        >
          <div className="-mx-4 -my-4 flex h-[65dvh] flex-col">
            <AgentPanel materialId={materialId} topicId={topicId} heading="This material" />
          </div>
        </Sheet>
      </div>
    </SourceProvider>
  );
}

function TopicList({
  topics,
  isPending,
  isError,
  error,
  onRetry,
  selectedId,
  onSelect,
}: {
  topics: Topic[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (isPending) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading topics">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <ol className="m-0 list-none divide-y divide-line">
      {topics.map((topic, index) => {
        const selected = topic.id === selectedId;
        return (
          <li key={topic.id}>
            <button
              type="button"
              onClick={() => onSelect(topic.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full min-h-12 items-start gap-2.5 px-2 py-2.5 text-left transition-colors',
                selected ? 'bg-lime-soft' : 'hover:bg-surface-sunken',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  selected ? 'bg-nav text-white' : 'bg-surface-sunken text-ink-muted',
                )}
              >
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{topic.name}</span>

                {topic.mastery ? (
                  <>
                    <span className="mt-1.5 block">
                      <ProgressBar
                        value={topic.mastery.score ?? 0}
                        label={`${topic.name} mastery`}
                        tone={MASTERY_BAR[topic.mastery.band]}
                      />
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted tabular-nums">
                      {topic.mastery.correctCount}/{topic.mastery.totalCount} correct ·{' '}
                      {MASTERY_LABEL[topic.mastery.band]}
                    </span>
                  </>
                ) : (
                  <span className="mt-0.5 block text-xs text-ink-subtle">Not practised yet</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
