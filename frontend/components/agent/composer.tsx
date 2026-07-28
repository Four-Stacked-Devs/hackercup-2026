'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AttachIcon, MicIcon, SendIcon } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/states';
import { useCurrentMaterial } from '@/components/providers/material-provider';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';
import { cn } from '@/lib/cn';

export interface QuickAction {
  label: string;
  prompt: string;
}

/** The four quick actions the product promises, in the student's words. */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Explain simply', prompt: 'Explain this topic simply, in plain language.' },
  { label: 'Give an example', prompt: 'Give me a worked example of this topic.' },
  { label: 'Summarise this section', prompt: 'Summarise this section in a few short points.' },
];

const TOOL = 'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted hover:bg-surface-sunken hover:text-ink';

export function Composer({
  onSend,
  disabled,
  busy,
  topicId,
  showContext = true,
  placeholder = 'Ask EDU anything about your material…',
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  busy?: boolean;
  topicId?: string | null;
  showContext?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const router = useRouter();
  const { material, materials, setMaterialId } = useCurrentMaterial();
  const createSet = useCreatePracticeSet();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  const makeQuestions = () => {
    if (!material) return;
    createSet.mutate(
      {
        materialId: material.id,
        kind: topicId ? 'focused' : 'diagnostic',
        ...(topicId ? { topicId } : {}),
        count: 5,
      },
      { onSuccess: (set) => router.push(`/practice/${set.id}`) },
    );
  };

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface px-3 py-3 sm:px-5">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={disabled}
            onClick={() => onSend(action.prompt)}
            className="min-h-9 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-sunken disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!material || createSet.isPending}
          onClick={makeQuestions}
          className="min-h-9 rounded-full border border-lime bg-lime-soft px-3 text-xs font-semibold text-ink hover:bg-lime disabled:opacity-50"
        >
          {createSet.isPending ? 'Building questions…' : 'Make practice questions'}
        </button>
      </div>

      {createSet.isError ? (
        <ErrorState className="mb-2" error={createSet.error} onRetry={makeQuestions} />
      ) : null}

      <div className="rounded-lg border border-line-strong bg-surface focus-within:border-nav">
        <label htmlFor="agent-input" className="sr-only">
          Ask EducLM about this material
        </label>
        <div className="flex items-end gap-2 px-2.5 pt-2">
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
            className="max-h-40 min-h-11 w-full resize-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-subtle"
          />

          <button
            type="submit"
            disabled={disabled || busy || !value.trim()}
            aria-label={busy ? 'Answering' : 'Send message'}
            className={cn(
              'mb-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime text-lime-ink transition-colors hover:bg-lime-strong',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <SendIcon />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-line px-1.5 py-1.5">
          <Link href="/upload" prefetch={false} className={TOOL}>
            <AttachIcon />
            Attach
          </Link>

          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Voice input — not in this build"
            className={cn(TOOL, 'cursor-not-allowed opacity-60 hover:bg-transparent')}
          >
            <MicIcon />
            Voice
            <span className="sr-only"> — not in this build</span>
          </button>

          {showContext && materials.length > 0 ? (
            <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
              <label htmlFor="material-context" className="shrink-0">
                Context
              </label>
              <select
                id="material-context"
                value={material?.id ?? ''}
                onChange={(event) => setMaterialId(event.target.value)}
                className="min-h-9 max-w-[9rem] truncate rounded-md border border-line bg-surface px-2 text-xs text-ink sm:max-w-[15rem]"
              >
                {materials.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}
