'use client';

import { useRouter } from 'next/navigation';
import type { LearningPlan, ProgressOverview, TopicMastery } from '@educlm/contracts';
import { Card, CardHeader, SectionHeading } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { MasteryPill } from '@/components/ui/chip';
import { ProgressBar, ProgressRing, StatTile, TrendLine } from '@/components/ui/charts';
import { EmptyState, ErrorState, InsufficientData, ScreenSkeleton } from '@/components/ui/states';
import { EduSays } from '@/components/brand/edu-mascot';
import { CONFIDENCE_LABEL, MASTERY_BAR, STEP_KIND_LABEL, percent, shortDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useProgressOverview, useRevertAdaptation } from '@/lib/hooks/use-progress';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';
import { FindingCard } from './finding-card';

/**
 * Weakness first, evidence second, action third — the numbers support the
 * argument rather than opening it.
 */
export function ProgressView({
  materialId,
  compact = false,
}: {
  materialId: string;
  /** Panel mode: same content, one column, tighter. */
  compact?: boolean;
}) {
  const query = useProgressOverview(materialId);

  if (query.isPending) return <ScreenSkeleton variant="stats" className="p-0" />;

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const overview = query.data;

  if (overview.totals.responseCount === 0) {
    return (
      <EmptyState
        title="No progress to show yet"
        description="Answer a few practice questions and this screen shows what you know, what keeps tripping you up, and the evidence behind both."
        action={<StartPracticeButton materialId={materialId} label="Start a practice set" />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <AgentSummary overview={overview} />

      <StatRow overview={overview} compact={compact} />

      <MasterySection overview={overview} compact={compact} />

      {overview.topFinding ? (
        <FindingCard
          finding={overview.topFinding}
          materialId={materialId}
          adaptation={overview.plan.lastAdaptation}
        />
      ) : (
        <Card>
          <CardHeader title="What keeps tripping you up" />
          <InsufficientData
            what="EDU hasn't seen the same mistake repeat yet."
            fix="Answer a few more questions and any pattern shows up here with the answers behind it."
          />
        </Card>
      )}

      <Milestones overview={overview} />

      <WhatChanged plan={overview.plan} materialId={materialId} />

      <NextStep plan={overview.plan} materialId={materialId} />

      <TrendCard overview={overview} />
    </div>
  );
}

/** What the numbers add up to, in a sentence, from EDU. */
function AgentSummary({ overview }: { overview: ProgressOverview }) {
  const ranked = overview.masteryByTopic.filter((topic) => topic.band !== 'insufficient_data');
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  const sentence =
    best && worst && best.topicId !== worst.topicId
      ? `You're solid on ${best.topicName}. ${worst.topicName} is where your answers are still coming apart.`
      : best
        ? `Your work so far is all on ${best.topicName}.`
        : 'There is not enough answered work yet to say where you stand.';

  const mood = worst && worst.band === 'needs_attention' ? 'wary' : 'default';

  return <EduSays mood={mood}>{sentence}</EduSays>;
}

function StatRow({ overview, compact }: { overview: ProgressOverview; compact: boolean }) {
  const withData = overview.masteryByTopic.filter((topic) => topic.band !== 'insufficient_data');
  const mastered = withData.filter((topic) => topic.band === 'strong').length;

  const trendText: Record<ProgressOverview['trend']['direction'], string> = {
    improving: 'Improving this week',
    declining: 'Slipping this week',
    flat: 'Holding steady',
    insufficient_data: 'Not enough days yet',
  };

  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
      <StatTile
        label="Answers correct"
        value={percent(overview.totals.accuracy)}
        hint={`${overview.totals.responseCount} answers recorded`}
        {...(overview.trend.direction !== 'insufficient_data'
          ? {
              trend: {
                direction:
                  overview.trend.direction === 'improving'
                    ? ('up' as const)
                    : overview.trend.direction === 'declining'
                      ? ('down' as const)
                      : ('flat' as const),
                text: trendText[overview.trend.direction],
              },
            }
          : {})}
      />
      <StatTile
        label="Topics mastered"
        value={`${mastered}/${withData.length}`}
        hint="of the topics you have practised"
      />
      <StatTile
        label="Practice sets"
        value={overview.totals.practiceSetsCompleted}
        hint="completed"
      />
      <StatTile
        label="Open findings"
        value={overview.topFinding ? 1 : 0}
        hint={overview.topFinding ? overview.topFinding.topicName : 'nothing repeating'}
      />
    </div>
  );
}

function MasterySection({
  overview,
  compact,
}: {
  overview: ProgressOverview;
  compact: boolean;
}) {
  const accuracy = overview.totals.accuracy;

  return (
    <Card>
      <CardHeader
        title="Performance by topic"
        description="Strongest first. Every band is a word, not just a colour."
      />

      <div className={cn('flex gap-5', compact ? 'flex-col' : 'flex-col md:flex-row')}>
        {!compact ? (
          <div className="shrink-0">
            {accuracy === null ? (
              <InsufficientData what="No overall score yet." fix="Answer a few questions to see it." />
            ) : (
              <ProgressRing value={accuracy} caption="answers correct" />
            )}
          </div>
        ) : null}

        <ul className="m-0 min-w-0 flex-1 list-none divide-y divide-line">
          {overview.masteryByTopic.map((topic) => (
            <MasteryRow key={topic.topicId} topic={topic} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function MasteryRow({ topic }: { topic: TopicMastery }) {
  const unknown = topic.band === 'insufficient_data';

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{topic.topicName}</span>
        <MasteryPill band={topic.band} />
      </div>

      {unknown ? (
        <p className="mt-1 text-xs text-ink-muted">
          Not enough data yet — answer a few more questions on this topic.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-[8rem] flex-1">
            <ProgressBar
              value={topic.score ?? 0}
              label={`${topic.topicName} mastery`}
              tone={MASTERY_BAR[topic.band]}
            />
          </div>
          <span className="text-xs text-ink-muted tabular-nums">
            {topic.correctCount}/{topic.totalCount} correct · {CONFIDENCE_LABEL[topic.confidence]}
          </span>
        </div>
      )}
    </li>
  );
}

/**
 * Recent milestones, restricted to events the API actually dates: a detected
 * finding and a plan adaptation. Step completions have no timestamp on the
 * wire, so they are summarised rather than given invented dates.
 */
function Milestones({ overview }: { overview: ProgressOverview }) {
  const done = overview.plan.steps.filter((step) => step.status === 'completed').length;

  const events: { at: string; text: string }[] = [];
  if (overview.plan.lastAdaptation) {
    events.push({
      at: overview.plan.lastAdaptation.at,
      text: `Plan adapted: ${overview.plan.lastAdaptation.newStepTitle} moved up`,
    });
  }
  if (overview.topFinding) {
    events.push({
      at: overview.topFinding.detectedAt,
      text: `Pattern found: ${overview.topFinding.label.toLowerCase()} in ${overview.topFinding.topicName}`,
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  if (events.length === 0 && done === 0) return null;

  return (
    <Card>
      <CardHeader title="Recent milestones" />
      <ol className="m-0 list-none space-y-2">
        {events.map((event) => (
          <li key={event.at + event.text} className="flex items-start gap-2.5 text-sm">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-lime" />
            <span className="min-w-0 flex-1 text-ink">{event.text}</span>
            <span className="whitespace-nowrap text-xs text-ink-muted">{shortDate(event.at)}</span>
          </li>
        ))}
        {done > 0 ? (
          <li className="flex items-start gap-2.5 text-sm">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-strong" />
            <span className="text-ink">
              {done} plan step{done === 1 ? '' : 's'} completed so far
            </span>
          </li>
        ) : null}
      </ol>
    </Card>
  );
}

/** The adaptation, stated plainly, with the student's veto next to it. */
function WhatChanged({ plan, materialId }: { plan: LearningPlan; materialId: string }) {
  const revert = useRevertAdaptation(materialId);
  const adaptation = plan.lastAdaptation;

  return (
    <Card>
      <CardHeader title="What changed" />

      {adaptation ? (
        <>
          <p className="text-sm text-ink">
            Your next step was <strong>{adaptation.previousStepTitle}</strong>. It&apos;s now{' '}
            <strong>{adaptation.newStepTitle}</strong>.
          </p>
          <p className="mt-1 text-xs text-ink-muted">Why: {adaptation.reason}.</p>

          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => revert.mutate()}
            disabled={revert.isPending}
          >
            {revert.isPending ? 'Restoring…' : 'Go back to the original plan'}
          </Button>

          {revert.isError ? (
            <ErrorState className="mt-3" error={revert.error} onRetry={() => revert.mutate()} />
          ) : null}
        </>
      ) : (
        <p className="text-sm text-ink-muted">
          Your plan is as you left it. EducLM only changes it when the same mistake repeats, and it
          always says so here.
        </p>
      )}
    </Card>
  );
}

function NextStep({ plan, materialId }: { plan: LearningPlan; materialId: string }) {
  const current =
    plan.steps.find((step) => step.id === plan.currentStepId) ??
    plan.steps.find((step) => step.status === 'active') ??
    plan.steps.find((step) => step.status === 'pending');

  if (!current) {
    return (
      <Card>
        <CardHeader title="Next step" />
        <p className="text-sm text-ink-muted">
          Every step in your plan is done. Add a material or start a practice set to keep going.
        </p>
      </Card>
    );
  }

  return (
    <Card className="border-lime">
      <CardHeader
        title="Recommended next step"
        description={`${STEP_KIND_LABEL[current.kind]} · about ${current.estimatedMinutes} min`}
      />
      <p className="font-display text-base font-bold text-ink">{current.title}</p>
      <p className="mt-1 text-sm text-ink-muted">{current.description}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {current.kind === 'practice' ? (
          <StartPracticeButton
            materialId={materialId}
            topicId={current.topicId}
            label="Start focused practice"
          />
        ) : current.target?.type === 'lesson' && current.target.id ? (
          <ButtonLink
            variant="primary"
            href={`/study/${materialId}?topicId=${encodeURIComponent(current.target.id)}`}
          >
            Open the lesson
          </ButtonLink>
        ) : (
          <ButtonLink variant="primary" href={`/study/${materialId}`}>
            Open the material
          </ButtonLink>
        )}
        <ButtonLink variant="outline" href={`/plan/${materialId}`}>
          See the whole plan
        </ButtonLink>
      </div>
    </Card>
  );
}

function TrendCard({ overview }: { overview: ProgressOverview }) {
  const { direction, points } = overview.trend;

  const sentence: Record<typeof direction, string> = {
    improving: 'Your accuracy is going up over the last few days.',
    declining: 'Your accuracy has slipped over the last few days.',
    flat: 'Your accuracy is holding steady.',
    insufficient_data: '',
  };

  return (
    <Card>
      <SectionHeading title="Progress over time" />

      {direction === 'insufficient_data' || points.length < 2 ? (
        <InsufficientData
          what="Not enough days of practice to show a trend."
          fix="Answer questions on two or more days and the line appears."
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink">{sentence[direction]}</p>
          <TrendLine points={points} />
        </>
      )}
    </Card>
  );
}

export function StartPracticeButton({
  materialId,
  topicId,
  label,
}: {
  materialId: string;
  topicId?: string | null;
  label: string;
}) {
  const router = useRouter();
  const createSet = useCreatePracticeSet();

  const start = () =>
    createSet.mutate(
      {
        materialId,
        kind: topicId ? 'focused' : 'diagnostic',
        ...(topicId ? { topicId } : {}),
        count: 5,
      },
      { onSuccess: (set) => router.push(`/practice/${set.id}`) },
    );

  return (
    <>
      <Button variant="primary" onClick={start} disabled={createSet.isPending}>
        {createSet.isPending ? 'Building your questions…' : label}
      </Button>
      {createSet.isError ? (
        <ErrorState className="mt-3 w-full" error={createSet.error} onRetry={start} />
      ) : null}
    </>
  );
}
