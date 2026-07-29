/**
 * The local message -> thread index.
 *
 * The API keeps ONE conversation per material and returns neither `topicId` nor
 * any thread id on a message, so the only place those associations exist is
 * here: the client records them as it sends. That makes the sidebar's threads a
 * local convenience, not server state.
 *
 * Two associations are stored per material:
 *  - `topics`        messageId -> topicId, for a thread opened from a topic
 *  - `conversations` messageId -> conversationId, minted by "New Chat" so each
 *                    new conversation is its own thread instead of merging into
 *                    a single untopiced pile
 *
 * Consequences, accepted deliberately:
 *  - a different browser, or cleared storage, shows the whole log as one thread
 *    rather than losing it;
 *  - nothing here is authoritative, so nothing here is ever sent to the API.
 */

const STORAGE_KEY = 'educlm.thread-index';

interface MaterialIndex {
  /** messageId -> topicId */
  topics: Record<string, string>;
  /** messageId -> conversationId */
  conversations: Record<string, string>;
}

/** materialId -> associations */
type Index = Record<string, MaterialIndex>;

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Prefixed so a conversation key can never be mistaken for a topic id or for
 * the ungrouped sentinel — the key ends up in the `?thread=` URL parameter.
 */
export function newConversationId(): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `conv-${suffix}`;
}

function read(): Index {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    return normalise(parsed);
  } catch {
    // Corrupt or unavailable storage must not take the sidebar down with it.
    return {};
  }
}

/**
 * The index sits outside React, and both the sidebar and the workspace read it
 * through their own `useThreads`. Without a shared signal a write in one would
 * leave the other rendering a stale index — the new conversation would appear
 * in the workspace and fall into the ungrouped thread in the rail.
 */
const listeners = new Set<() => void>();
let revision = 0;

export function subscribeToIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function indexRevision(): number {
  return revision;
}

function write(index: Index): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    // Quota or private mode. Threads degrade to one thread; nothing breaks.
  }

  revision += 1;
  for (const listener of listeners) listener();
}

/**
 * Reads both the current shape and the original one, in which a material mapped
 * straight to `messageId -> topicId`. Those entries are topics and the
 * conversation map starts empty, so an upgrade leaves every existing thread
 * exactly where it was.
 */
function normalise(value: unknown): Index {
  if (!isRecord(value)) return {};

  const index: Index = {};

  for (const [materialId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;

    // The old shape: every value is a topic id string.
    if (isStringMap(entry)) {
      index[materialId] = { topics: { ...entry }, conversations: {} };
      continue;
    }

    index[materialId] = {
      topics: isStringMap(entry['topics']) ? { ...entry['topics'] } : {},
      conversations: isStringMap(entry['conversations'])
        ? { ...entry['conversations'] }
        : {},
    };
  }

  return index;
}

export function readTopicIndex(materialId: string): Readonly<Record<string, string>> {
  return read()[materialId]?.topics ?? EMPTY;
}

export function readConversationIndex(
  materialId: string,
): Readonly<Record<string, string>> {
  return read()[materialId]?.conversations ?? EMPTY;
}

/** Records the topic for one or more message ids. A null topic records nothing. */
export function recordMessageTopics(
  materialId: string,
  topicId: string | null | undefined,
  messageIds: readonly string[],
): void {
  record(materialId, 'topics', topicId, messageIds);
}

/** Records the conversation for one or more message ids. */
export function recordMessageConversation(
  materialId: string,
  conversationId: string | null | undefined,
  messageIds: readonly string[],
): void {
  record(materialId, 'conversations', conversationId, messageIds);
}

function record(
  materialId: string,
  field: keyof MaterialIndex,
  value: string | null | undefined,
  messageIds: readonly string[],
): void {
  if (!value || messageIds.length === 0) return;

  const index = read();
  const forMaterial = index[materialId] ?? { topics: {}, conversations: {} };
  const updated = { ...forMaterial[field] };
  for (const id of messageIds) updated[id] = value;

  index[materialId] = { ...forMaterial, [field]: updated };
  write(index);
}

/** Called when the conversation is cleared, so the index cannot outlive it. */
export function forgetMaterial(materialId: string): void {
  const index = read();
  if (!(materialId in index)) return;

  delete index[materialId];
  write(index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
