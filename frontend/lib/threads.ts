import type { ChatMessage, Topic } from '@educlm/contracts';

/**
 * Chat threads.
 *
 * The API keeps ONE conversation per material and does not return `topicId` on
 * a message (`chatMessageSchema` is id/role/content/citations/createdAt), so a
 * thread cannot be reconstructed from the server alone. What the client does
 * know is the topic it sent each message under; that is recorded locally by
 * `lib/thread-index.ts` and passed in here as `topicOf`.
 *
 * Everything in this file is pure: same inputs, same threads, no clock, no
 * storage, no fetch. The clock arrives as `now`.
 *
 * A message with no recorded topic is never hidden — it falls into the
 * `null` thread, titled after its first user message.
 */

/** The label for a thread that has no topic and no user message to name it. */
export const UNGROUPED_TITLE = 'New chat';

/** How long a derived title may get before it is cut mid-thought. */
const TITLE_MAX_CHARS = 40;

/**
 * A conversation is named the way chat products name them: after the first
 * thing the student asked. Whitespace is flattened so a pasted snippet does
 * not become a three-line sidebar row.
 */
export function deriveTitle(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (!flat) return UNGROUPED_TITLE;
  return flat.length > TITLE_MAX_CHARS ? `${flat.slice(0, TITLE_MAX_CHARS - 1)}…` : flat;
}

/** Topic name when the thread has one, else the first user message, else the fallback. */
function titleFor(topicName: string | undefined, threadMessages: readonly ChatMessage[]): string {
  if (topicName) return topicName;
  const firstUserMessage = threadMessages.find((message) => message.role === 'user');
  return firstUserMessage ? deriveTitle(firstUserMessage.content) : UNGROUPED_TITLE;
}

export interface ChatThread {
  /** Stable list key. The topic id, or `__ungrouped__`. */
  key: string;
  topicId: string | null;
  title: string;
  messages: ChatMessage[];
  /** createdAt of the most recent message in the thread. */
  lastActivityAt: string;
  /** Preview line for the sidebar row: the last thing said. */
  preview: string;
}

export type ThreadBucket = 'today' | 'yesterday' | 'previous7' | 'older';

export interface ThreadGroup {
  bucket: ThreadBucket;
  label: string;
  threads: ChatThread[];
}

const BUCKET_LABEL: Record<ThreadBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  previous7: 'Previous 7 Days',
  older: 'Older',
};

const UNGROUPED_KEY = '__ungrouped__';

/**
 * Splits a material's message log into threads.
 *
 * @param messages  the material's full log, any order
 * @param topicOf   message id -> topic id, from the local index
 * @param topics    the material's topics, for real names
 */
export function buildThreads(
  messages: ChatMessage[],
  topicOf: Readonly<Record<string, string>>,
  topics: readonly Topic[],
): ChatThread[] {
  const nameOf = new Map(topics.map((topic) => [topic.id, topic.name]));
  const byTopic = new Map<string, ChatMessage[]>();

  const ordered = [...messages].sort(byCreatedAtAscending);
  const resolved = withAdjacentQuestions(ordered, topicOf);

  for (const message of ordered) {
    const topicId = resolved[message.id];
    // A recorded topic that is no longer in the material (deleted, or from
    // another material's index) is treated as unrecorded rather than dropped.
    const key = topicId && nameOf.has(topicId) ? topicId : UNGROUPED_KEY;

    const bucket = byTopic.get(key);
    if (bucket) bucket.push(message);
    else byTopic.set(key, [message]);
  }

  const threads: ChatThread[] = [];

  for (const [key, threadMessages] of byTopic) {
    const last = threadMessages[threadMessages.length - 1];
    if (!last) continue;

    threads.push({
      key,
      topicId: key === UNGROUPED_KEY ? null : key,
      title: titleFor(key === UNGROUPED_KEY ? undefined : nameOf.get(key), threadMessages),
      // `ordered` was sorted before bucketing, so each bucket is already in order.
      messages: threadMessages,
      lastActivityAt: last.createdAt,
      preview: previewOf(last),
    });
  }

  // Most recently active first, which is also the order the buckets read in.
  return threads.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * Buckets threads by recency for the sidebar's date headings.
 * Empty buckets are omitted so no heading appears over nothing.
 */
export function groupThreadsByRecency(
  threads: readonly ChatThread[],
  now: Date,
): ThreadGroup[] {
  const buckets: Record<ThreadBucket, ChatThread[]> = {
    today: [],
    yesterday: [],
    previous7: [],
    older: [],
  };

  for (const thread of threads) {
    buckets[bucketFor(thread.lastActivityAt, now)].push(thread);
  }

  return (['today', 'yesterday', 'previous7', 'older'] as const)
    .filter((bucket) => buckets[bucket].length > 0)
    .map((bucket) => ({ bucket, label: BUCKET_LABEL[bucket], threads: buckets[bucket] }));
}

/** Which heading a thread sits under, by calendar day rather than by 24h spans. */
export function bucketFor(timestamp: string, now: Date): ThreadBucket {
  const days = calendarDaysBetween(new Date(timestamp), now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'previous7';
  return 'older';
}

/** Case-insensitive match on the thread title and its message text. */
export function filterThreads(threads: readonly ChatThread[], query: string): ChatThread[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...threads];

  return threads.filter(
    (thread) =>
      thread.title.toLowerCase().includes(needle) ||
      thread.messages.some((message) => message.content.toLowerCase().includes(needle)),
  );
}

export function findThread(
  threads: readonly ChatThread[],
  topicId: string | null,
): ChatThread | undefined {
  return threads.find((thread) => thread.topicId === topicId);
}

/**
 * Only the assistant's message id comes back from the stream, so the question
 * that prompted it is never recorded directly. The log is strictly ordered
 * question-then-answer, so a user message immediately followed by an answer
 * with a known topic belongs to that same thread.
 *
 * This reads adjacency, not content — it cannot invent an association that the
 * ordering does not already show.
 */
function withAdjacentQuestions(
  ordered: readonly ChatMessage[],
  topicOf: Readonly<Record<string, string>>,
): Record<string, string> {
  const resolved: Record<string, string> = { ...topicOf };

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const message = ordered[index];
    const next = ordered[index + 1];
    if (!message || !next) continue;

    if (message.role === 'user' && next.role === 'assistant' && !resolved[message.id]) {
      const topicId = resolved[next.id];
      if (topicId) resolved[message.id] = topicId;
    }
  }

  return resolved;
}

function byCreatedAtAscending(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function previewOf(message: ChatMessage): string {
  const flat = message.content.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/** Whole days between two instants, counted on local calendar days. */
function calendarDaysBetween(then: Date, now: Date): number {
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}
