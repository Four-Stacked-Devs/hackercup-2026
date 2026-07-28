import { DEFAULT_DEVICE_ID } from './config';

const STORAGE_KEY = 'educlm.device-id';

/**
 * The MVP has no login. Identity is an anonymous per-device id, created on
 * first use and sent as X-Device-Id on every request.
 *
 * It starts as the seeded demo device so a fresh browser opens on the demo
 * material in live mode; "Start a fresh device" in settings rotates it.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return DEFAULT_DEVICE_ID;

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  window.localStorage.setItem(STORAGE_KEY, DEFAULT_DEVICE_ID);
  return DEFAULT_DEVICE_ID;
}

export function resetDeviceId(): string {
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `device-${crypto.randomUUID()}`
      : `device-${Date.now()}`;

  window.localStorage.setItem(STORAGE_KEY, fresh);
  return fresh;
}
