'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { CloseIcon } from './icons';

/**
 * Bottom sheet on phones, side panel on desktop — the wireframe's two shapes
 * for the same thing. Radix owns the focus trap, escape handling and the
 * accessible title, which is exactly the part worth not hand-rolling.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'bottom',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'bottom' | 'right';
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/35 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface shadow-xl outline-none animate-slide-up',
            side === 'bottom'
              ? 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t border-line'
              : 'inset-y-0 right-0 w-full max-w-[min(30rem,100vw)] border-l border-line',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-base font-bold text-ink">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-ink-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken"
              aria-label="Close"
            >
              <CloseIcon />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

          {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Asks once, then does the thing. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/35 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-xl outline-none animate-fade-in">
          <Dialog.Title className="font-display text-lg font-bold text-ink">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-ink-muted">
            {body}
          </Dialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Dialog.Close className="min-h-11 rounded-md border border-line-strong px-4 text-sm hover:bg-surface-sunken">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={cn(
                'min-h-11 rounded-md px-4 text-sm font-semibold',
                destructive
                  ? 'bg-attention text-white hover:opacity-90'
                  : 'bg-lime text-lime-ink hover:bg-lime-strong',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
