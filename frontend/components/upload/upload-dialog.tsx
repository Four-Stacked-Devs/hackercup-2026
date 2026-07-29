'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CloseIcon } from '@/components/ui/icons';
import { UploadView } from './upload-view';

interface UploadDialogContextValue {
  /** Opens the add-material modal from anywhere in the app. */
  openUpload: () => void;
}

const UploadDialogContext = createContext<UploadDialogContextValue | null>(null);

/**
 * Add material is a modal, not a destination: it interrupts whatever screen
 * the student is on and returns them to it, so nothing of their context is
 * lost. The dialog unmounts its content on close, which also resets a
 * half-finished upload form.
 */
export function UploadDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openUpload = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ openUpload }), [openUpload]);

  return (
    <UploadDialogContext.Provider value={value}>
      {children}

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/35 animate-fade-in" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-xl outline-none animate-fade-in"
            // Uploading continues server-side either way; closing by accident
            // mid-flight is worse than an extra click on the close button.
            onInteractOutside={(event) => event.preventDefault()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <Dialog.Title className="font-display text-base font-bold text-ink">
                  Add material
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-sm text-ink-muted">
                  One PDF becomes a lesson, a plan and a question bank.
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken"
                aria-label="Close"
              >
                <CloseIcon />
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {open ? <UploadView onRequestClose={close} /> : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </UploadDialogContext.Provider>
  );
}

export function useUploadDialog(): UploadDialogContextValue {
  const context = useContext(UploadDialogContext);
  if (!context) throw new Error('useUploadDialog must be used inside UploadDialogProvider');
  return context;
}
