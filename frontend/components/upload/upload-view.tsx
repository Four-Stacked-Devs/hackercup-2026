'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { IngestionStage, Material } from '@educlm/contracts';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/charts';
import { ErrorState } from '@/components/ui/states';
import { AlertIcon, CheckIcon, UploadIcon } from '@/components/ui/icons';
import { isApiError } from '@/lib/api/client';
import { API_MODE, DEMO_MATERIAL_ID, MAX_UPLOAD_BYTES } from '@/lib/config';
import { useMaterialStatus, useUploadMaterial } from '@/lib/hooks/use-materials';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { cn } from '@/lib/cn';

/** Plain language for each ingestion stage. No jargon, no spinner-only states. */
const STAGE_LABEL: Record<IngestionStage, string> = {
  extracting: 'Reading the pages',
  chunking: 'Splitting the text into passages',
  extracting_topics: 'Finding the topics',
  embedding: 'Indexing it so answers can cite a page',
  building_lessons: 'Building the accessible lesson',
  done: 'Ready',
};

const STAGE_ORDER: IngestionStage[] = [
  'extracting',
  'chunking',
  'extracting_topics',
  'embedding',
  'building_lessons',
];

export function UploadView({ onRequestClose }: { onRequestClose?: () => void }) {
  const router = useRouter();
  const upload = useUploadMaterial();
  const { setMaterialId } = useCurrentMaterial();
  const [material, setMaterial] = useState<Material | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const status = useMaterialStatus(material?.id ?? null, material !== null);

  const ready = status.data?.status === 'ready';
  const failed = status.data?.status === 'failed';

  useEffect(() => {
    if (ready && material) setMaterialId(material.id);
  }, [ready, material, setMaterialId]);

  const accept = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;

    if (file.type && file.type !== 'application/pdf') {
      setLocalError('EducLM reads PDF files. Pick a PDF and try again.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError('That file is over 20 MB. Try a smaller PDF.');
      return;
    }

    upload.mutate({ file }, { onSuccess: setMaterial });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };

  if (material) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader
            title={material.title}
            description={material.originalFilename}
          />

          {failed ? (
            <FailureNotice
              code={status.data?.failure?.code ?? 'INTERNAL_ERROR'}
              message={status.data?.failure?.message ?? 'That file could not be prepared.'}
              onRetry={() => {
                setMaterial(null);
                upload.reset();
              }}
              {...(onRequestClose ? { onNavigate: onRequestClose } : {})}
            />
          ) : ready ? (
            <div>
              <p className="flex items-center gap-2 font-display font-bold text-strong-ink">
                <CheckIcon />
                Ready to study
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {material.title} is now a lesson you can read, question and practise.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    onRequestClose?.();
                    router.push(`/study/${material.id}`);
                  }}
                >
                  Open the lesson
                </Button>
                {onRequestClose ? (
                  <Button variant="outline" onClick={onRequestClose}>
                    Done
                  </Button>
                ) : (
                  <ButtonLink variant="outline" href="/">
                    Back to the agent
                  </ButtonLink>
                )}
              </div>
            </div>
          ) : (
            <ProcessingStages
              stage={status.data?.processing?.stage ?? 'extracting'}
              percent={status.data?.processing?.percent ?? 0}
              message={status.data?.processing?.message ?? STAGE_LABEL.extracting}
            />
          )}
        </Card>

        {status.isError ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Add your own material"
          description="One PDF, up to 20 MB. EducLM reads it, finds the topics, and builds a lesson you can question."
        />

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            dragging ? 'border-lime bg-lime-soft' : 'border-line-strong bg-surface-sunken',
          )}
        >
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-lime text-lime-ink">
            <UploadIcon />
          </span>
          <p className="font-display text-lg font-bold text-ink">
            Drop your PDF here
          </p>
          <p className="mx-auto mt-1 max-w-[46ch] text-sm text-ink-muted">
            Or choose a file. Next, EducLM reads the pages, finds the topics, and builds the
            lesson — it takes a few seconds.
          </p>

          <input
            ref={inputRef}
            id="material-file"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => accept(event.target.files?.[0])}
          />
          <Button
            variant="primary"
            size="lg"
            className="mt-4"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? 'Uploading…' : 'Choose a PDF'}
          </Button>
        </div>

        {localError ? (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-attention">
            <AlertIcon width="1em" height="1em" className="mt-0.5 shrink-0" />
            {localError}
          </p>
        ) : null}

        {upload.isError ? (
          <div className="mt-3">
            <FailureNotice
              code={isApiError(upload.error) ? upload.error.code : 'INTERNAL_ERROR'}
              message={
                isApiError(upload.error)
                  ? upload.error.message
                  : 'That upload did not go through. Try again.'
              }
              onRetry={() => upload.reset()}
              {...(onRequestClose ? { onNavigate: onRequestClose } : {})}
            />
          </div>
        ) : null}
      </Card>

      {/*
        Mock mode only: the sample module is a fixture MSW serves to anyone. In
        live mode it is a real row owned by the seed user, and every browser
        mints its own device id, so this would route to someone else's material
        and come back NOT_FOUND.
      */}
      {API_MODE === 'mock' ? (
        <Card>
          <CardHeader
            title="No file to hand?"
            description="Open the sample module and every screen works the same way."
          />
          <Button
            variant="outline"
            onClick={() => {
              setMaterialId(DEMO_MATERIAL_ID);
              onRequestClose?.();
              router.push(`/study/${DEMO_MATERIAL_ID}`);
            }}
          >
            Use the sample module
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

/** The stages, named as they happen. This is not a spinner. */
function ProcessingStages({
  stage,
  percent,
  message,
}: {
  stage: IngestionStage;
  percent: number;
  message: string;
}) {
  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div>
      <p className="font-display font-bold text-ink" aria-live="polite">
        {message}
      </p>

      <div className="mt-3">
        <ProgressBar value={percent / 100} label="Preparing your material" />
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">
        {percent}% · usually under a minute for a module this size.
      </p>

      <ol className="mt-4 m-0 list-none space-y-1.5">
        {STAGE_ORDER.map((entry, index) => {
          const done = currentIndex > index;
          const active = currentIndex === index;

          return (
            <li
              key={entry}
              className={cn(
                'flex items-center gap-2 text-sm',
                done ? 'text-ink-muted' : active ? 'font-medium text-ink' : 'text-ink-muted opacity-60',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  done
                    ? 'border-strong bg-strong text-white'
                    : active
                      ? 'border-nav bg-nav text-white'
                      : 'border-line',
                )}
              >
                {done ? <CheckIcon width="0.8em" height="0.8em" /> : null}
              </span>
              {STAGE_LABEL[entry]}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Errors say what happened and what to do about it. */
function FailureNotice({
  code,
  message,
  onRetry,
  onNavigate,
}: {
  code: string;
  message: string;
  onRetry: () => void;
  /** Set when shown inside the modal, so leaving for the sample closes it. */
  onNavigate?: () => void;
}) {
  const advice: Record<string, string> = {
    NO_TEXT_LAYER:
      'If a scan is all you have, ask your teacher for the original file — EducLM needs real text to quote a page back to you.',
    UNSUPPORTED_FILE: 'EducLM reads PDF files. Export or save your file as a PDF and try again.',
    FILE_TOO_LARGE: 'Split the module into smaller PDFs, or try a version under 20 MB.',
    RATE_LIMITED: 'Wait a minute, then upload again.',
  };

  return (
    <div className="rounded-lg border border-attention/40 bg-attention-soft p-4" role="alert">
      <p className="flex items-center gap-2 font-display font-bold text-ink">
        <AlertIcon className="text-attention" />
        That file could not be prepared
      </p>
      <p className="mt-1 text-sm text-ink">{message}</p>
      {advice[code] ? <p className="mt-1 text-sm text-ink-muted">{advice[code]}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try another file
        </Button>
        {/* Same reason as the card above: reachable in mock mode only. */}
        {API_MODE === 'mock' ? (
          <ButtonLink
            variant="ghost"
            size="sm"
            href={`/study/${DEMO_MATERIAL_ID}`}
            onClick={onNavigate}
          >
            Use the sample module instead
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
