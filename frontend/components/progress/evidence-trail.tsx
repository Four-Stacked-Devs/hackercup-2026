'use client';

import type { EvidenceItem, MisconceptionFinding, PlanAdaptation } from '@educlm/contracts';
import { PageRef } from '@/components/source/source-sheet';
import { timeAgo } from '@/lib/format';

/**
 * The signature element.
 *
 * A finding unfolds into the exact responses that produced it, each linked down
 * to the page it came from, ending at the plan change it caused. One connected
 * thread, because the claim being made is a chain: this answer, then this one,
 * then this one, therefore this change.
 */
export function EvidenceTrail({
  finding,
  adaptation,
}: {
  finding: MisconceptionFinding;
  adaptation?: PlanAdaptation | null;
}) {
  const showsAdaptation = adaptation?.triggeredByFindingId === finding.id;

  return (
    <ol className="relative m-0 list-none space-y-3 py-1 pl-8">
      {/* The thread itself. */}
      <span
        aria-hidden="true"
        className="absolute bottom-3 left-3 top-3 w-px -translate-x-1/2 bg-line-strong"
      />

      {finding.evidence.map((item, index) => (
        <EvidenceNode key={item.responseId} item={item} index={index} />
      ))}

      {showsAdaptation ? (
        <li
          className="relative animate-trail"
          style={{ animationDelay: `${finding.evidence.length * 60}ms` }}
        >
          <TrailMarker tone="accent" label="Result" />
          <div className="rounded-lg border border-lime bg-lime-soft p-3">
            <h3 className="font-display text-sm font-bold text-ink">
              So your plan changed
            </h3>
            <p className="mt-1 text-sm text-ink">
              <span className="line-through decoration-ink-muted">
                {adaptation.previousStepTitle}
              </span>{' '}
              → <strong>{adaptation.newStepTitle}</strong>
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {adaptation.reason} · {timeAgo(adaptation.at)}
            </p>
          </div>
        </li>
      ) : null}
    </ol>
  );
}

function EvidenceNode({ item, index }: { item: EvidenceItem; index: number }) {
  return (
    <li className="relative animate-trail" style={{ animationDelay: `${index * 60}ms` }}>
      <TrailMarker tone="attention" label={`Answer ${index + 1}`} />

      <article className="rounded-lg border border-line bg-surface p-3">
        <h3 className="font-display text-sm font-bold text-ink">{item.questionStem}</h3>

        <dl className="mt-2 space-y-1.5 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">You chose</dt>
            <dd className="font-medium text-attention-ink">
              {item.selectedOptionLabel}. {item.selectedOptionText}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">The answer</dt>
            <dd className="font-medium text-strong-ink">{item.correctOptionText}</dd>
          </div>
        </dl>

        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>{timeAgo(item.answeredAt)}</span>
          <span aria-hidden="true">·</span>
          <span>Explained on</span>
          <PageRef page={item.sourcePage} />
        </p>
      </article>
    </li>
  );
}

function TrailMarker({ tone, label }: { tone: 'attention' | 'accent'; label: string }) {
  return (
    <span
      className={`absolute -left-8 top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-surface ${
        tone === 'accent' ? 'border-lime' : 'border-attention'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${tone === 'accent' ? 'bg-lime' : 'bg-attention'}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
