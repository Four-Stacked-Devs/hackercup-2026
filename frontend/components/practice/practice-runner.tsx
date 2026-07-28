'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  PracticeSet,
  PracticeSetResult,
  Question,
  QuestionFeedback,
} from '@educlm/contracts';
import { Card, CardHeader, SectionHeading } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Meter, ProgressRing, StatTile, StepProgress } from '@/components/ui/charts';
import { Markdown } from '@/components/ui/markdown';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { AlertIcon, CheckIcon, CloseIcon } from '@/components/ui/icons';
import { EduMascot, EduSays } from '@/components/brand/edu-mascot';
import { CitationChip, PageRef } from '@/components/source/source-sheet';
import { DIFFICULTY_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  useCompletePracticeSet,
  usePracticeSet,
  useSubmitResponse,
} from '@/lib/hooks/use-practice';

/**
 * One question at a time. Selecting highlights; a separate Check submits.
 * Nothing auto-submits — an accidental tap would pollute the very responses the
 * analytics engine reasons from.
 */
export function PracticeRunner({ setId }: { setId: string }) {
  const query = usePracticeSet(setId);

  if (query.isPending) return <PracticeSkeleton />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const set = query.data;

  if (set.questions.length === 0) {
    return (
      <EmptyState
        title="This set has no questions"
        description="EDU could not build questions for that topic. Try a different topic, or start a set for the whole material."
        action={
          <ButtonLink href="/practice" variant="primary">
            Back to practice
          </ButtonLink>
        }
      />
    );
  }

  return <RunnerBody key={set.id} set={set} />;
}

function RunnerBody({ set }: { set: PracticeSet }) {
  const [index, setIndex] = useState(() => Math.min(set.answeredCount, set.questions.length - 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<QuestionFeedback | null>(null);
  const [result, setResult] = useState<PracticeSetResult | null>(null);
  const startedAt = useRef(Date.now());
  const feedbackRef = useRef<HTMLDivElement | null>(null);

  const submit = useSubmitResponse(set.id);
  const complete = useCompletePracticeSet(set.id, set.materialId);

  const question = set.questions[index]!;
  const isLast = index === set.questions.length - 1;

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  if (result) return <ResultView set={set} result={result} />;

  const check = () => {
    if (!selected) return;
    submit.mutate(
      {
        questionId: question.id,
        selectedOptionId: selected,
        timeSpentMs: Date.now() - startedAt.current,
      },
      { onSuccess: setFeedback },
    );
  };

  const next = () => {
    setFeedback(null);
    setSelected(null);
    if (isLast) complete.mutate(undefined, { onSuccess: setResult });
    else setIndex((current) => current + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink">
            {set.topicName ?? 'Practice'}
          </h2>
          <p className="text-xs text-ink-muted">
            {set.kind === 'focused'
              ? 'Focused practice'
              : set.kind === 'retry'
                ? 'Retry'
                : 'Diagnostic set'}
            {set.reason ? ` · ${set.reason}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Chip tone="neutral">{DIFFICULTY_LABEL[question.difficulty]}</Chip>
          <span className="text-xs font-medium text-ink-muted tabular-nums">
            Question {index + 1} of {set.questions.length}
          </span>
        </div>
      </div>

      <StepProgress total={set.questions.length} current={index + 1} label="Practice progress" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <QuestionCard
          question={question}
          selected={selected}
          onSelect={setSelected}
          locked={feedback !== null}
          feedback={feedback}
        />

        <div className="space-y-3">
          <ExplanationPanel
            feedback={feedback}
            question={question}
            panelRef={feedbackRef}
          />

          {feedback?.misconception ? (
            <EduSays mood="wary">
              {feedback.misconception.label} — {feedback.misconception.description}
            </EduSays>
          ) : feedback?.isCorrect ? (
            <EduSays mood="letsgo">
              That is exactly it. Keep going while the reasoning is fresh.
            </EduSays>
          ) : null}
        </div>
      </div>

      {submit.isError ? <ErrorState error={submit.error} onRetry={check} /> : null}

      <div className="flex flex-wrap gap-2">
        {feedback ? (
          <Button variant="primary" size="lg" onClick={next} disabled={complete.isPending}>
            {complete.isPending ? 'Finishing…' : isLast ? 'See your results' : 'Next question'}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              onClick={check}
              disabled={!selected || submit.isPending}
            >
              {submit.isPending ? 'Checking…' : 'Check answer'}
            </Button>
            <ButtonLink
              href={`/study/${set.materialId}?topicId=${question.topicId}`}
              variant="outline"
              size="lg"
            >
              Read the lesson instead
            </ButtonLink>
          </>
        )}
      </div>

      {complete.isError ? <ErrorState error={complete.error} onRetry={next} /> : null}
    </div>
  );
}

function QuestionCard({
  question,
  selected,
  onSelect,
  locked,
  feedback,
}: {
  question: Question;
  selected: string | null;
  onSelect: (id: string) => void;
  locked: boolean;
  feedback: QuestionFeedback | null;
}) {
  return (
    <Card as="div">
      <fieldset disabled={locked} className="m-0 border-0 p-0">
        <legend className="mb-3 font-display text-base font-bold text-ink">{question.stem}</legend>

        <div className="space-y-2">
          {question.options.map((option) => {
            const isSelected = selected === option.id;
            const isCorrect = feedback?.correctOptionId === option.id;
            const isWrongPick =
              feedback?.isCorrect === false && feedback.selectedOptionId === option.id;

            return (
              <label
                key={option.id}
                className={cn(
                  'flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                  isCorrect
                    ? 'border-strong bg-strong-soft'
                    : isWrongPick
                      ? 'border-attention bg-attention-soft'
                      : isSelected
                        ? 'border-nav bg-lime-soft'
                        : 'border-line bg-surface hover:border-line-strong',
                  locked && 'cursor-default',
                )}
              >
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option.id}
                  checked={isSelected}
                  onChange={() => onSelect(option.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                    isCorrect
                      ? 'border-strong bg-strong text-white'
                      : isWrongPick
                        ? 'border-attention bg-attention text-white'
                        : isSelected
                          ? 'border-nav bg-lime text-lime-ink'
                          : 'border-line-strong text-ink-muted',
                  )}
                >
                  {isCorrect ? (
                    <CheckIcon width="0.9em" height="0.9em" />
                  ) : isWrongPick ? (
                    <CloseIcon width="0.9em" height="0.9em" />
                  ) : (
                    option.label
                  )}
                </span>
                <span className="min-w-0 flex-1 text-ink">{option.text}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="mt-3 text-xs text-ink-muted">
        From your material, <PageRef page={question.sourcePage} />
      </p>
    </Card>
  );
}

/** The right-hand panel: empty until the answer is checked, then the reasoning. */
function ExplanationPanel({
  feedback,
  question,
  panelRef,
}: {
  feedback: QuestionFeedback | null;
  question: Question;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      aria-live="polite"
      className={cn(
        'rounded-lg border bg-surface p-3.5 outline-none',
        feedback
          ? feedback.isCorrect
            ? 'border-strong'
            : 'border-attention'
          : 'border-dashed border-line-strong',
      )}
    >
      <SectionHeading title="Explanation" level={3} />

      {!feedback ? (
        <p className="text-sm text-ink-muted">
          Pick an answer and check it. EDU explains the reasoning here, with the page it came from.
        </p>
      ) : (
        <div className="animate-slide-up">
          <p
            className={cn(
              'font-display text-sm font-bold',
              feedback.isCorrect ? 'text-strong-ink' : 'text-attention-ink',
            )}
          >
            {feedback.isCorrect ? 'Correct' : 'Not quite'}
          </p>

          <div className="mt-1.5 text-sm text-ink">
            <Markdown className="prose-compact">{feedback.explanationMarkdown}</Markdown>
          </div>

          {feedback.misconception ? (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-md border border-line bg-surface-sunken px-2.5 py-2 text-xs text-ink">
              <AlertIcon width="1em" height="1em" className="mt-0.5 shrink-0 text-attention" />
              {feedback.misconception.label}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <CitationChip citation={feedback.citation} />
            <span className="text-xs text-ink-muted">{question.topicName}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultView({ set, result }: { set: PracticeSet; result: PracticeSetResult }) {
  const changed = result.newFindings.length > 0 || result.planUpdated;
  const score = result.total === 0 ? 0 : result.correctCount / result.total;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Practice complete" description={set.topicName ?? undefined} />

        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <ProgressRing value={score} caption="of this set" size={116} />

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Correct" value={result.correctCount} hint={`of ${result.total}`} />
            <StatTile
              label="Incorrect"
              value={result.total - result.correctCount}
              hint={`of ${result.total}`}
            />
            <StatTile label="Topics covered" value={result.byTopic.length} hint="in this set" />
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading title="Performance by topic" />
        <div className="space-y-2.5">
          {result.byTopic.map((topic) => (
            <Meter
              key={topic.topicId}
              label={topic.topicName}
              value={topic.total === 0 ? 0 : topic.correct / topic.total}
              detail={`${topic.correct}/${topic.total}`}
            />
          ))}
        </div>
      </Card>

      {changed ? (
        <Card className="border-lime">
          <SectionHeading title="Recommended next steps" />
          <ul className="m-0 list-none space-y-2">
            {result.newFindings.map((finding) => (
              <li key={finding.id} className="flex items-start gap-2 text-sm text-ink">
                <CheckIcon width="1em" height="1em" className="mt-0.5 shrink-0 text-lime-strong" />
                <span>
                  EDU noticed {finding.label.toLowerCase()} in {finding.occurrences} of your last{' '}
                  {finding.windowSize} answers on {finding.topicName}.
                </span>
              </li>
            ))}
            {result.planUpdated ? (
              <li className="flex items-start gap-2 text-sm text-ink">
                <CheckIcon width="1em" height="1em" className="mt-0.5 shrink-0 text-lime-strong" />
                <span>Your plan has been updated to match.</span>
              </li>
            ) : null}
          </ul>

          <ButtonLink variant="primary" className="mt-3" href={`/progress/${set.materialId}`}>
            See the evidence on Progress
          </ButtonLink>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-ink-muted">
            No new pattern showed up in these answers, so your plan stays as it is.
          </p>
          <ButtonLink variant="outline" className="mt-3" href={`/progress/${set.materialId}`}>
            Open progress
          </ButtonLink>
        </Card>
      )}
    </div>
  );
}

/** The set is generated on request, so this is a real wait with a real reason. */
export function PracticeSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <Skeleton className="h-4 w-1/3" />
      <Card>
        <Skeleton className="h-5 w-3/4" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      </Card>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <EduMascot mood="thinking" size={28} />
        Building questions from your material. This takes a few seconds.
      </p>
    </div>
  );
}
