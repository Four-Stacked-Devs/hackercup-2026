'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MisconceptionFinding, PlanAdaptation } from '@educlm/contracts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/sheet';
import { ErrorState } from '@/components/ui/states';
import { AlertIcon, ChevronDown, ChevronRight } from '@/components/ui/icons';
import { useDismissFinding } from '@/lib/hooks/use-progress';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';
import { EvidenceTrail } from './evidence-trail';

/**
 * "What keeps tripping you up", in the student's own terms, with the evidence
 * one control away. The claim and its proof are never on separate screens.
 */
export function FindingCard({
  finding,
  materialId,
  adaptation,
}: {
  finding: MisconceptionFinding;
  materialId: string;
  adaptation: PlanAdaptation | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  const dismiss = useDismissFinding(materialId);
  const createSet = useCreatePracticeSet();

  const startFocusedPractice = () => {
    createSet.mutate(
      { materialId, kind: 'focused', topicId: finding.topicId, count: 5 },
      { onSuccess: (set) => router.push(`/practice/${set.id}`) },
    );
  };

  return (
    <Card className="border-attention/35">
      <div className="flex items-start gap-2.5">
        <AlertIcon className="mt-0.5 shrink-0 text-attention" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-ink">
            What keeps tripping you up
          </h2>

          <p className="mt-1.5 text-base text-ink">
            {finding.label} in <strong>{finding.occurrences}</strong> of your last{' '}
            <strong>{finding.windowSize}</strong> answers on {finding.topicName}.
          </p>
          <p className="mt-1 text-sm text-ink-muted">{finding.description}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              aria-controls={`evidence-${finding.id}`}
            >
              {expanded ? <ChevronDown /> : <ChevronRight />}
              {expanded ? 'Hide the evidence' : 'Show the evidence'}
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={startFocusedPractice}
              disabled={createSet.isPending}
            >
              {createSet.isPending ? 'Building questions…' : 'Practise this now'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="text-ink-muted"
              onClick={() => setConfirming(true)}
              disabled={dismiss.isPending || finding.status !== 'active'}
            >
              This isn&apos;t right
            </Button>
          </div>

          {createSet.isError ? (
            <ErrorState className="mt-3" error={createSet.error} onRetry={startFocusedPractice} />
          ) : null}
          {dismiss.isError ? (
            <ErrorState
              className="mt-3"
              error={dismiss.error}
              onRetry={() => dismiss.mutate(finding.id)}
            />
          ) : null}

          {finding.status === 'dismissed' ? (
            <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              Dismissed. EducLM won&apos;t raise this one again.
            </p>
          ) : null}

          <div id={`evidence-${finding.id}`} hidden={!expanded} className="mt-3">
            {expanded ? (
              finding.evidence.length > 0 ? (
                <EvidenceTrail finding={finding} adaptation={adaptation} />
              ) : (
                <p className="text-sm text-ink-muted">
                  The responses behind this finding are no longer available.
                </p>
              )
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Dismiss this finding?"
        body="EducLM will stop raising it and will not adapt your plan for it. You can still practise the topic whenever you like."
        confirmLabel="Dismiss it"
        onConfirm={() => dismiss.mutate(finding.id)}
      />
    </Card>
  );
}
