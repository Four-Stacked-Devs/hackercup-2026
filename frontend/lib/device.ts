import { DEFAULT_DEVICE_ID } from './config';

const STORAGE_KEY = 'educlm.device-id';

function mintDeviceId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `device-${crypto.randomUUID()}`
    : `device-${Date.now()}`;
}

/**
 * The MVP has no login. Identity is an anonymous per-device id, created on
 * first use and sent as X-Device-Id on every request.
 *
 * Every browser mints its own id. The API scopes materials, chat, progress and
 * plans to the user behind that header and exposes no public read path, so a
 * shared default would put every visitor of the deployed app in one account,
 * reading and overwriting each other's work.
 */
export function getDeviceId(): string {
  // Prerender has no localStorage. Nothing calls the API server-side, so this
  // branch never reaches the network — it only keeps the module importable.
  if (typeof window === 'undefined') return DEFAULT_DEVICE_ID;

  const existing = window.localStorage.getItem(STORAGE_KEY);

  // An id equal to the shared default was written by an earlier build, when
  // every browser started as the seeded demo student. Keeping it would open the
  // app on someone else's library — the seed's material — instead of a clean
  // slate, so it is rotated once, here, rather than left to linger.
  if (existing && existing !== DEFAULT_DEVICE_ID) return existing;

  const fresh = mintDeviceId();
  window.localStorage.setItem(STORAGE_KEY, fresh);
  return fresh;
}

export function resetDeviceId(): string {
  const fresh = mintDeviceId();
  window.localStorage.setItem(STORAGE_KEY, fresh);
  return fresh;
}
