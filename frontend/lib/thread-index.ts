/**
 * The local message -> topic index.
 *
 * The API does not return `topicId` on a chat message, so the only place that
 * association exists is here: the client records it when it sends a message
 * and when the stream hands back the assistant reply. That makes the sidebar's
 * topic threads a local convenience, not server state.
 *
 * Consequences, accepted deliberately:
 *  - a different browser, or cleared storage, shows the whole log under
 *    the first-message thread rather than losing it;
 *  - nothing here is authoritative, so nothing here is ever sent to the API.
 */

const STORAGE_KEY = 'educlm.thread-index';

/** materialId -> (messageId -> topicId) */
type Index = Record<string, Record<string, string>>;

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});

function read(): Index {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    return isIndex(parsed) ? parsed : {};
  } catch {
    // Corrupt or unavailable storage must not take the sidebar down with it.
    return {};
  }
}

function write(index: Index): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    // Quota or private mode. Threads degrade to the ungrouped thread; nothing breaks.
  }
}

export function readTopicIndex(materialId: string): Readonly<Record<string, string>> {
  return read()[materialId] ?? EMPTY;
}

/** Records the topic for one or more message ids. A null topic records nothing. */
export function recordMessageTopics(
  materialId: string,
  topicId: string | null | undefined,
  messageIds: readonly string[],
): void {
  if (!topicId || messageIds.length === 0) return;

  const index = read();
  const forMaterial = { ...(index[materialId] ?? {}) };
  for (const id of messageIds) forMaterial[id] = topicId;

  index[materialId] = forMaterial;
  write(index);
}

/** Called when the conversation is cleared, so the index cannot outlive it. */
export function forgetMaterial(materialId: string): void {
  const index = read();
  if (!(materialId in index)) return;

  delete index[materialId];
  write(index);
}

function isIndex(value: unknown): value is Index {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  return Object.values(value).every(
    (inner) =>
      typeof inner === 'object' &&
      inner !== null &&
      !Array.isArray(inner) &&
      Object.values(inner).every((topicId) => typeof topicId === 'string'),
  );
}
