'use client';

import { useState, type ComponentType, type SVGProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { Topic } from '@educlm/contracts';
import { Card, SectionHeading } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { MasteryPill } from '@/components/ui/chip';
import { ProgressBar } from '@/components/ui/charts';
import { Sheet } from '@/components/ui/sheet';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import {
  ChatIcon,
  CloseIcon,
  DocIcon,
  ExpandIcon,
  PlanIcon,
  ProgressIcon,
  SparkIcon,
  UploadIcon,
} from '@/components/ui/icons';
import { EduMascot, EduSays } from '@/components/brand/edu-mascot';
import { WorkspaceHeader } from '@/components/shell/workspace-header';
import { SourceProvider } from '@/components/source/source-sheet';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { usePreferences } from '@/components/providers/preferences-provider';
import { useChatMessages, useChatStream, useTopics } from '@/lib/hooks/use-study';
import { useProgressOverview } from '@/lib/hooks/use-progress';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';
import { clearChat } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/query-keys';
import { MASTERY_BAR, timeAgo } from '@/lib/format';
import { PlanView } from '@/components/plan/plan-view';
import { ProgressView } from '@/components/progress/progress-view';
import { Conversation, AgentWorking } from './conversation';
import { Composer } from './composer';
import { ArtifactCards } from './artifact-cards';

type Panel = 'plan' | 'progress';

/**
 * Home is the agent. Everything else in the product — the plan, practice,
 * progress, the material itself — is reachable from this conversation, either
 * as a panel beside it or as a full workspace.
 */
export function AgentWorkspace() {
  const { material, materials, isLoading, error, refetch } = useCurrentMaterial();
  const [panel, setPanel] = useState<Panel | null>(null);

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
      <WorkspaceHeader
        title={material.title}
        subtitle={
          processing
            ? 'Still being prepared'
            : `${material.topicCount} topics · ${material.pageCount ?? 0} pages · plan active`
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => setPanel('plan')}>
            <ExpandIcon />
            <span className="hidden sm:inline">Open workspace</span>
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
          {processing ? (
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
          ) : (
            <ConversationColumn materialId={material.id} onOpenPanel={setPanel} />
          )}
        </section>

        {panel ? (
          <aside
            className="hidden w-[25rem] shrink-0 flex-col border-l border-line bg-surface xl:flex"
            aria-label={panel === 'plan' ? 'Learning plan workspace' : 'Progress workspace'}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="font-display text-sm font-bold text-ink">
                {panel === 'plan' ? 'Learning plan' : 'Progress'}
              </h2>
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanel(panel === 'plan' ? 'progress' : 'plan')}
                >
                  {panel === 'plan' ? 'Show progress' : 'Show plan'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Close the workspace"
                  onClick={() => setPanel(null)}
                >
                  <CloseIcon />
                </Button>
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {panel === 'plan' ? (
                <PlanView materialId={material.id} materialTitle={material.title} compact />
              ) : (
                <ProgressView materialId={material.id} compact />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {/* Below xl the workspace opens over the conversation instead of beside it. */}
      <div className="xl:hidden">
        <Sheet
          open={panel !== null}
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
          title={panel === 'progress' ? 'Progress' : 'Learning plan'}
          description={material.title}
          side="bottom"
        >
          {panel === 'progress' ? (
            <ProgressView materialId={material.id} compact />
          ) : (
            <PlanView materialId={material.id} materialTitle={material.title} compact />
          )}
        </Sheet>
      </div>
    </SourceProvider>
  );
}

function ConversationColumn({
  materialId,
  onOpenPanel,
}: {
  materialId: string;
  onOpenPanel: (panel: Panel) => void;
}) {
  const history = useChatMessages(materialId);
  const stream = useChatStream(materialId);
  const { material } = useCurrentMaterial();

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <Conversation
            messages={history.data ?? []}
            isPending={history.isPending}
            isError={history.isError}
            error={history.error}
            onRetry={() => void history.refetch()}
            pendingQuestion={stream.pendingQuestion}
            answer={stream.answer}
            streamError={stream.error}
            emptyState={<Greeting materialId={materialId} onSend={stream.send} />}
          />

          {stream.answer ? <AgentWorking answer={stream.answer} /> : null}

          {material ? <ArtifactCards material={material} onOpenWorkspace={onOpenPanel} /> : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <Composer onSend={(message) => stream.send(message)} busy={stream.isStreaming} />
      </div>
    </>
  );
}

/** The greeting: who is here, what they can do next, and where they left off. */
function Greeting({
  materialId,
  onSend,
}: {
  materialId: string;
  onSend: (message: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { displayName } = usePreferences();
  const progress = useProgressOverview(materialId);
  const topics = useTopics(materialId);
  const createSet = useCreatePracticeSet();

  const weakest = [...(progress.data?.masteryByTopic ?? [])]
    .filter((topic) => topic.band !== 'insufficient_data')
    .pop();

  const practised = (topics.data ?? [])
    .filter((topic): topic is Topic & { mastery: NonNullable<Topic['mastery']> } =>
      Boolean(topic.mastery?.lastAnsweredAt),
    )
    .sort((a, b) =>
      (b.mastery.lastAnsweredAt ?? '').localeCompare(a.mastery.lastAnsweredAt ?? ''),
    )
    .slice(0, 4);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold text-ink">
            Welcome back{displayName ? `, ${displayName.split(' ')[0]}` : ''}.
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            What would you like to work on? EDU answers from your own material, and shows the page
            behind every answer.
          </p>
        </div>
        <EduMascot size={72} className="hidden sm:block" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          icon={ChatIcon}
          title="Start a new chat"
          detail="Clear this thread and begin again"
          onClick={() => {
            void clearChat(materialId).catch(() => undefined);
            queryClient.setQueryData(queryKeys.chat(materialId), []);
          }}
        />
        <ActionCard
          icon={SparkIcon}
          title={weakest ? `Explain ${weakest.topicName}` : 'Explain a topic'}
          detail="Ask EDU to break it down"
          onClick={() =>
            onSend(
              weakest
                ? `Explain ${weakest.topicName} simply, with an example from my material.`
                : 'Explain the first topic in this material simply.',
            )
          }
        />
        <ActionCard
          icon={DocIcon}
          title="Check what you know"
          detail={createSet.isPending ? 'Building your questions…' : 'Five questions, mixed topics'}
          onClick={() =>
            createSet.mutate(
              { materialId, kind: 'diagnostic', count: 5 },
              { onSuccess: (set) => router.push(`/practice/${set.id}`) },
            )
          }
          disabled={createSet.isPending}
        />
        <ActionCard
          icon={ProgressIcon}
          title="Review my progress"
          detail="What you know and what keeps tripping you up"
          href={`/progress/${materialId}`}
        />
      </div>

      {createSet.isError ? <ErrorState error={createSet.error} /> : null}

      {practised.length > 0 ? (
        <div>
          <SectionHeading
            title="Continue where you left off"
            level={3}
            action={
              <Link
                href={`/study/${materialId}`}
                prefetch={false}
                className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                View all topics
              </Link>
            }
          />

          <ul className="m-0 grid list-none gap-2 sm:grid-cols-2">
            {practised.map((topic) => (
              <li key={topic.id}>
                <Link
                  href={`/study/${materialId}?topicId=${encodeURIComponent(topic.id)}`}
                  prefetch={false}
                  className="block rounded-lg border border-line bg-surface p-3 transition-colors hover:bg-surface-sunken"
                >
                  <p className="truncate text-sm font-semibold text-ink">{topic.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Last practised {timeAgo(topic.mastery.lastAnsweredAt as string)}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <ProgressBar
                        value={topic.mastery.score ?? 0}
                        label={`${topic.name} mastery`}
                        tone={MASTERY_BAR[topic.mastery.band]}
                      />
                    </span>
                    <span className="text-xs font-semibold text-ink tabular-nums">
                      {topic.mastery.correctCount}/{topic.mastery.totalCount}
                    </span>
                  </div>
                  {/* The bar colour never carries the band on its own. */}
                  <div className="mt-1.5">
                    <MasteryPill band={topic.mastery.band} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {weakest ? (
        <EduSays mood="wary">
          {weakest.topicName} is where your answers come apart most often. A short focused set
          moves it faster than re-reading.
        </EduSays>
      ) : (
        <EduSays>
          Answer a few questions and I can tell you exactly which idea to work on next — with the
          answers that prove it.
        </EduSays>
      )}
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  detail,
  onClick,
  href,
  disabled,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  detail: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const body = (
    <>
      <Icon className="text-ink" />
      <span className="mt-2 block text-sm font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-xs text-ink-muted">{detail}</span>
    </>
  );

  const shell =
    'block min-h-[5.5rem] rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-sunken disabled:opacity-50';

  if (href) {
    return (
      <Link href={href} prefetch={false} className={shell}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={shell}>
      {body}
    </button>
  );
}

/** Nothing uploaded yet: an invitation, not a shrug. */
function FirstRun() {
  return (
    <>
      <WorkspaceHeader title="EducLM" subtitle="One agent. Your goals. Every step." />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg text-center">
          <EduMascot size={88} className="mx-auto mb-3" />
          <h2 className="font-display text-xl font-bold text-ink">
            Hi, I&apos;m EDU. What are we studying?
          </h2>
          <p className="mx-auto mt-1.5 max-w-[52ch] text-sm text-ink-muted">
            Add a PDF module and I turn it into a lesson you can read, question and practise — with
            the original page behind every answer.
          </p>

          <div className="mt-5 grid gap-2 text-left">
            <ButtonLink href="/upload" variant="primary" size="lg" full>
              <UploadIcon />
              Upload material and build a study plan
            </ButtonLink>
            <ButtonLink href="/library" variant="outline" size="lg" full>
              <PlanIcon />
              Open the sample module
            </ButtonLink>
          </div>
        </div>
      </div>
    </>
  );
}
