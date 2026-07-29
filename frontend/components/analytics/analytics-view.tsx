'use client';

import type { MasteryBand, TopicMastery } from '@educlm/contracts';
import { Card } from '@/components/ui/card';
import { Meter, SegmentRing, StatTile, TrendLine } from '@/components/ui/charts';
import { ErrorState, InsufficientData, ScreenSkeleton } from '@/components/ui/states';
import { percent } from '@/lib/format';
import { useProgressOverview } from '@/lib/hooks/use-progress';

/**
 * Learning Analytics: the numbers behind the Progress screen's story, all
 * computed by the analytics engine and served in one `GET /progress/overview`.
 * Only measured quantities appear — there is no study-time or streak data in
 * the API, so none is shown.
 */

const BAND_TONE = {
  strong: 'strong',
  developing: 'developing',
  needs_attention: 'attention',
  insufficient_data: 'neutral',
} as const;

/** Static classes — Tailwind cannot see an interpolated name. */
const BAND_DOT: Record<MasteryBand, string> = {
  strong: 'bg-strong',
  developing: 'bg-developing',
  needs_attention: 'bg-attention',
  insufficient_data: 'bg-neutral',
};

const BAND_LABEL: Record<MasteryBand, string> = {
  strong: 'Strong',
  developing: 'Developing',
  needs_attention: 'Needs attention',
  insufficient_data: 'Not enough data',
};

const TREND_LABEL = {
  improving: { direction: 'up', text: 'Improving' },
  declining: { direction: 'down', text: 'Declining' },
  flat: { direction: 'flat', text: 'Holding steady' },
} as const;

export function AnalyticsView({ materialId }: { materialId: string }) {
  const query = useProgressOverview(materialId);

  if (query.isPending) return <ScreenSkeleton variant="stats" className="p-0" />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const overview = query.data;
  const { totals, trend, masteryByTopic } = overview;

  const strongCount = masteryByTopic.filter((topic) => topic.band === 'strong').length;
  const weakTopics = masteryByTopic.filter((topic) => topic.band === 'needs_attention');

  return (
    <div className="space-y-4">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Quiz accuracy"
          value={totals.accuracy === null ? '—' : percent(totals.accuracy)}
          {...(trend.direction !== 'insufficient_data'
            ? { trend: TREND_LABEL[trend.direction] }
            : { hint: 'Across all practice' })}
        />
        <StatTile
          label="Questions answered"
          value={totals.responseCount}
          hint="Across all practice"
        />
        <StatTile
          label="Practice sets completed"
          value={totals.practiceSetsCompleted}
          hint="Diagnostic, focused and retry"
        />
        <StatTile
          label="Topics strong"
          value={`${strongCount} / ${masteryByTopic.length}`}
          hint="Of the topics you have practised"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-label="Accuracy trend">
          <h2 className="font-display text-sm font-bold text-ink">Accuracy trend</h2>
          <p className="mb-3 text-xs text-ink-muted">
            Daily accuracy on practice questions, oldest to newest.
          </p>
          {trend.direction === 'insufficient_data' ? (
            <InsufficientData
              what="Fewer than six answers so far."
              fix="Finish a practice set and the trend appears here."
            />
          ) : (
            <TrendLine points={trend.points} />
          )}
        </Card>

        <Card as="section" aria-label="Mastery by band">
          <h2 className="font-display text-sm font-bold text-ink">Topic mastery</h2>
          <p className="mb-3 text-xs text-ink-muted">
            Every practised topic, banded by recency-weighted accuracy.
          </p>
          {masteryByTopic.length === 0 ? (
            <InsufficientData
              what="No topics practised yet."
              fix="Answer a few questions and the bands appear here."
            />
          ) : (
            <div className="flex flex-wrap items-center gap-5">
              <SegmentRing
                segments={(
                  ['strong', 'developing', 'needs_attention', 'insufficient_data'] as const
                ).map((band) => ({
                  label: BAND_LABEL[band],
                  count: masteryByTopic.filter((topic) => topic.band === band).length,
                  tone: BAND_TONE[band],
                }))}
                total={masteryByTopic.length}
                caption="topics"
              />
              <ul className="m-0 flex min-w-[10rem] flex-1 list-none flex-col gap-1.5">
                {(['strong', 'developing', 'needs_attention', 'insufficient_data'] as const)
                  .map((band) => ({
                    band,
                    count: masteryByTopic.filter((topic) => topic.band === band).length,
                  }))
                  .filter((entry) => entry.count > 0)
                  .map((entry) => (
                    <li key={entry.band} className="flex items-center gap-2 text-sm text-ink">
                      <span
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 rounded-full ${BAND_DOT[entry.band]}`}
                      />
                      <span className="flex-1">{BAND_LABEL[entry.band]}</span>
                      <span className="font-semibold tabular-nums">{entry.count}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card as="section" aria-label="Weak topics">
        <h2 className="font-display text-sm font-bold text-ink">Weak topics</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Topics whose recent answers put them in the needs-attention band.
        </p>
        {weakTopics.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing needs attention right now. Keep practising to keep it that way.
          </p>
        ) : (
          <div className="space-y-2.5">
            {weakTopics.map((topic) => (
              <TopicMeter key={topic.topicId} topic={topic} />
            ))}
          </div>
        )}
      </Card>

      <Card as="section" aria-label="Mastery by topic">
        <h2 className="font-display text-sm font-bold text-ink">Performance by topic</h2>
        <p className="mb-3 text-xs text-ink-muted">Strongest first, from your answer history.</p>
        <div className="space-y-2.5">
          {masteryByTopic.map((topic) => (
            <TopicMeter key={topic.topicId} topic={topic} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function TopicMeter({ topic }: { topic: TopicMastery }) {
  if (topic.score === null) {
    return (
      <Meter
        label={topic.topicName}
        value={0}
        tone="neutral"
        detail={<span className="text-ink-muted">Not enough data</span>}
      />
    );
  }

  return (
    <Meter
      label={topic.topicName}
      value={topic.score}
      tone={BAND_TONE[topic.band]}
      detail={`${percent(topic.score)} · ${topic.correctCount}/${topic.totalCount}`}
    />
  );
}
