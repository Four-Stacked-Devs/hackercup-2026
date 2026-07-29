'use client';

import { useRouter } from 'next/navigation';
import { useCreatePracticeSet } from '@/lib/hooks/use-practice';
import { ErrorState } from '@/components/ui/states';
import { ExamplesIcon, PlanIcon, QuizIcon, SimplifyIcon } from '@/components/ui/icons';

/**
 * The follow-ups offered under EDU's last answer.
 *
 * Every one of these is backed: two build something server-side (a practice set,
 * the plan) and two are simply the next question, pre-written. Nothing here is
 * a button that only looks like it does something.
 */
export function ActionChips({
  materialId,
  topicId,
  onAsk,
  busy,
}: {
  materialId: string;
  /** The thread's topic, so a generated set is about what was being discussed. */
  topicId: string | null;
  onAsk: (message: string) => void;
  busy: boolean;
}) {
  const router = useRouter();
  const createSet = useCreatePracticeSet();

  const building = createSet.isPending;

  return (
    <div className="ml-[42px]">
      <ul className="m-0 flex list-none flex-wrap gap-2">
        <li>
          <Chip
            icon={<QuizIcon />}
            label={building ? 'Building your questions…' : 'Create quiz'}
            disabled={building}
            onClick={() =>
              createSet.mutate(
                {
                  materialId,
                  kind: topicId ? 'focused' : 'diagnostic',
                  ...(topicId ? { topicId } : {}),
                  count: 5,
                },
                { onSuccess: (set) => router.push(`/practice/${set.id}`) },
              )
            }
          />
        </li>
        <li>
          <Chip
            icon={<PlanIcon />}
            label="Turn into study plan"
            onClick={() => router.push(`/plan/${materialId}`)}
          />
        </li>
        <li>
          <Chip
            icon={<SimplifyIcon />}
            label="Explain more simply"
            disabled={busy}
            onClick={() => onAsk('Explain that again more simply, as if I am new to it.')}
          />
        </li>
        <li>
          <Chip
            icon={<ExamplesIcon />}
            label="More examples"
            disabled={busy}
            onClick={() => onAsk('Show me another example of that from my material.')}
          />
        </li>
      </ul>

      {createSet.isError ? (
        <div className="mt-2">
          <ErrorState error={createSet.error} />
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="text-ink-muted">{icon}</span>
      {label}
    </button>
  );
}
