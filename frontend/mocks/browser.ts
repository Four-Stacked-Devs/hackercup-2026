import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

let started: Promise<unknown> | null = null;

/**
 * MSW intercepts at the network layer, so hooks, loading states and error
 * handling are identical in mock and live mode. Switching to live is one
 * environment variable, not a code change.
 */
export function startMockWorker(): Promise<unknown> {
  started ??= worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  return started;
}
