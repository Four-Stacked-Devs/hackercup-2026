'use client';

import { useRouter } from 'next/navigation';
import type { Material } from '@educlm/contracts';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { MasteryPill } from '@/components/ui/chip';
import { ProgressBar } from '@/components/ui/charts';
import { InsufficientData, SkeletonCard } from '@/components/ui/states';
import { AlertIcon, ChevronRight, DocIcon } from '@/components/ui/icons';
import { MASTERY_BAR, percent } from '@/lib/format';
import { usePlan, useProgressOverview } from '@/lib/hooks/use-progress';
import { useTopics } from '@/lib/hooks/use-study';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';

/**
 * The panels the agent generates beside the conversation — plan, weak topic,
 * progress, sources. Each is a real read of a real endpoint, and each opens the
 * workspace where the full version lives.
 */
export function ArtifactCards({
  material,
  onOpenWorkspace,
}: {
  material: Material;
  onOpenWorkspace: (panel: 'plan' | 'progress') => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <PlanPreviewCard materialId={material.id} onOpen={() => onOpenWorkspace('plan')} />
      <WeakTopicCard materialId={material.id} />
      <ProgressSnapshotCard materialId={material.id} onOpen={() => onOpenWorkspace('progress')} />
      <SourcesCard material={material} />
    </div>
  );
}

const LINK = 'mt-3 inline-flex items-center gap-1 text-xs font-semibold text-ink underline decoration-lime decoration-2 underline-offset-4 hover:decoration-lime-strong';

function PlanPreviewCard({ materialId, onOpen }: { materialId: string; onOpen: () => void }) {
  const query = usePlan(materialId);

  if (query.isPending) return <SkeletonCard lines={4} />;
  if (query.isError) return null;

  const plan = query.data;
  const upcoming = plan.steps
    .filter((step) => step.status === 'active' || step.status === 'pending')
    .slice(0, 4);
  const done = plan.steps.filter((step) => step.status === 'completed').length;
  const remaining = plan.steps
    .filter((step) => step.status !== 'completed' && step.status !== 'skipped')
    .reduce((total, step) => total + step.estimatedMinutes, 0);

  return (
    <Card>
      <CardHeader
        title="Your study plan"
        description={`${remaining} min left · ${done} of ${plan.steps.length} done`}
        level={3}
      />

      {upcoming.length === 0 ? (
        <p className="text-sm text-ink-muted">Every step is done. Well played.</p>
      ) : (
        <ol className="m-0 list-none divide-y divide-line">
          {upcoming.map((step, index) => (
            <li key={step.id} className="flex items-center gap-2 py-1.5 text-sm first:pt-0">
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-ink-muted tabular-nums"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{step.title}</span>
              <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                {step.estimatedMinutes} min
              </span>
            </li>
          ))}
        </ol>
      )}

      <button type="button" onClick={onOpen} className={LINK}>
        View the full plan
        <ChevronRight width="0.9em" height="0.9em" />
      </button>
    </Card>
  );
}

function WeakTopicCard({ materialId }: { materialId: string }) {
  const query = useProgressOverview(materialId);
  const createSet = useCreatePracticeSet();
  const router = useRouter();

  if (query.isPending) return <SkeletonCard lines={3} />;
  if (query.isError) return null;

  const weakest = [...query.data.masteryByTopic]
    .filter((topic) => topic.band !== 'insufficient_data')
    .pop();

  if (!weakest) {
    return (
      <Card>
        <CardHeader title="Weak topics" level={3} />
        <InsufficientData
          what="No topic has enough answers to judge yet."
          fix="Answer a practice set and this fills in."
        />
      </Card>
    );
  }

  const start = () =>
    createSet.mutate(
      { materialId, kind: 'focused', topicId: weakest.topicId, count: 5 },
      { onSuccess: (set) => router.push(`/practice/${set.id}`) },
    );

  return (
    <Card className={weakest.band === 'needs_attention' ? 'border-attention/40' : undefined}>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            {weakest.band === 'needs_attention' ? (
              <AlertIcon width="1em" height="1em" className="text-attention" />
            ) : null}
            Weakest topic
          </span>
        }
        level={3}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{weakest.topicName}</span>
        <MasteryPill band={weakest.band} />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <ProgressBar
            value={weakest.score ?? 0}
            label={`${weakest.topicName} mastery`}
            tone={MASTERY_BAR[weakest.band]}
          />
        </span>
        <span className="text-xs text-ink-muted tabular-nums">
          {weakest.correctCount}/{weakest.totalCount} · {percent(weakest.score)}
        </span>
      </div>

      <Button
        variant="primary"
        size="sm"
        className="mt-3"
        onClick={start}
        disabled={createSet.isPending}
      >
        {createSet.isPending ? 'Building questions…' : 'Practise this now'}
      </Button>
    </Card>
  );
}

function ProgressSnapshotCard({
  materialId,
  onOpen,
}: {
  materialId: string;
  onOpen: () => void;
}) {
  const query = useProgressOverview(materialId);

  if (query.isPending) return <SkeletonCard lines={3} />;
  if (query.isError) return null;

  const { totals, trend } = query.data;

  return (
    <Card>
      <CardHeader title="Progress snapshot" level={3} />

      {totals.accuracy === null ? (
        <InsufficientData
          what="No answers recorded yet."
          fix="Finish a practice set to see your accuracy."
        />
      ) : (
        <>
          <p className="font-display text-2xl font-bold text-ink tabular-nums">
            {percent(totals.accuracy)}
          </p>
          <p className="text-xs text-ink-muted">
            of {totals.responseCount} answers correct ·{' '}
            {trend.direction === 'insufficient_data'
              ? 'not enough days for a trend'
              : trend.direction === 'improving'
                ? 'improving'
                : trend.direction === 'declining'
                  ? 'slipping'
                  : 'holding steady'}
          </p>
          <div className="mt-2">
            <ProgressBar value={totals.accuracy} label="Overall accuracy" />
          </div>
        </>
      )}

      <button type="button" onClick={onOpen} className={LINK}>
        Open progress
        <ChevronRight width="0.9em" height="0.9em" />
      </button>
    </Card>
  );
}

function SourcesCard({ material }: { material: Material }) {
  const query = useTopics(material.id);

  return (
    <Card>
      <CardHeader
        title="Connected sources"
        description={`${material.pageCount ?? 0} pages · ${material.topicCount} topics`}
        level={3}
      />

      <ul className="m-0 list-none space-y-1.5">
        <li className="flex items-center gap-2 text-sm">
          <DocIcon className="shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-ink">{material.originalFilename}</span>
        </li>
        {(query.data ?? []).slice(0, 3).map((topic) => (
          <li key={topic.id} className="flex items-center gap-2 pl-7 text-xs text-ink-muted">
            <span className="min-w-0 flex-1 truncate">{topic.name}</span>
            <span className="shrink-0 tabular-nums">
              p. {topic.sourcePages[0]}–{topic.sourcePages[topic.sourcePages.length - 1]}
            </span>
          </li>
        ))}
      </ul>

      <ButtonLink variant="ghost" size="sm" className={LINK} href={`/study/${material.id}`}>
        Open the material
        <ChevronRight width="0.9em" height="0.9em" />
      </ButtonLink>
    </Card>
  );
}
