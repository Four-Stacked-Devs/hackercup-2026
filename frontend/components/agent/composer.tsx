'use client';

import { useState, type FormEvent } from 'react';
import { cn } from '@/lib/cn';
import { AttachIcon, ChevronDownIcon, PlusIcon, SendIcon } from '@/components/ui/icons';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useUploadDialog } from '@/components/upload/upload-dialog';
import { useTopics } from '@/lib/hooks/use-study';

/**
 * The composer.
 *
 * One bordered field with its controls on a second row: add material, attach,
 * and the context pill naming what EDU is answering about. The mockup also
 * shows a microphone and a camera; neither has anything behind it here, so
 * neither is drawn — a control that cannot work is worse than an absent one.
 */
export function Composer({
  onSend,
  disabled,
  busy,
  topicId,
  onTopicChange,
  showContext = true,
  placeholder = 'Message EDU…',
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  busy?: boolean;
  topicId?: string | null;
  /** Present on the home composer, where the thread's topic can be switched. */
  onTopicChange?: (topicId: string | null) => void;
  showContext?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const { material, materials, setMaterialId } = useCurrentMaterial();
  const { openUpload } = useUploadDialog();
  const topics = useTopics(showContext ? (material?.id ?? null) : null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || disabled || busy) return;
    onSend(value.trim());
    setValue('');
  };

  return (
    <form onSubmit={submit} className="px-3 pb-3 sm:px-5">
      <div className="rounded-xl border border-line-strong bg-surface shadow-card focus-within:border-nav">
        <label htmlFor="agent-input" className="sr-only">
          Message EDU about your material
        </label>

        <textarea
          id="agent-input"
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
          className="max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 text-sm text-ink outline-none placeholder:text-ink-subtle"
        />

        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          <button
            type="button"
            onClick={openUpload}
            aria-label="Add a material"
            title="Add a material"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <PlusIcon />
          </button>

          <button
            type="button"
            onClick={openUpload}
            aria-label="Attach a PDF"
            title="Attach a PDF"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <AttachIcon />
          </button>

          {showContext && materials.length > 0 ? (
            <>
              <ContextPill>
                <label htmlFor="material-context" className="sr-only">
                  Material EDU answers from
                </label>
                <select
                  id="material-context"
                  value={material?.id ?? ''}
                  onChange={(event) => {
                    setMaterialId(event.target.value);
                    onTopicChange?.(null);
                  }}
                  className="max-w-[9rem] cursor-pointer truncate bg-transparent pr-1 text-xs font-medium text-ink outline-none sm:max-w-[14rem]"
                >
                  {materials.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </ContextPill>

              {onTopicChange && (topics.data ?? []).length > 0 ? (
                <ContextPill>
                  <label htmlFor="topic-context" className="sr-only">
                    Topic this conversation is about
                  </label>
                  <select
                    id="topic-context"
                    value={topicId ?? ''}
                    onChange={(event) => onTopicChange(event.target.value || null)}
                    className="max-w-[9rem] cursor-pointer truncate bg-transparent pr-1 text-xs font-medium text-ink outline-none sm:max-w-[14rem]"
                  >
                    <option value="">All topics</option>
                    {(topics.data ?? []).map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                </ContextPill>
              ) : null}
            </>
          ) : null}

          <button
            type="submit"
            disabled={disabled || busy || !value.trim()}
            aria-label={busy ? 'Answering' : 'Send message'}
            className={cn(
              'ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime text-lime-ink transition-colors hover:bg-lime-strong',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <SendIcon />
          </button>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-ink-subtle">
        AI can make mistakes. Consider checking important information.
      </p>
    </form>
  );
}

function ContextPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex min-h-9 items-center gap-1 rounded-full border border-lime bg-lime-soft px-3">
      {children}
      <ChevronDownIcon
        width="0.9em"
        height="0.9em"
        aria-hidden="true"
        className="shrink-0 text-ink-muted"
      />
    </span>
  );
}
