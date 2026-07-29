import { describe, expect, it } from 'vitest';
import type { ChatMessage, Topic } from '@educlm/contracts';
import { buildThreads, findThread, findThreadByKey } from './threads';

const msg = (id: string, role: 'user' | 'assistant', content: string, min: number): ChatMessage => ({
  id,
  role,
  content,
  citations: [],
  createdAt: new Date(Date.UTC(2026, 6, 29, 10, min)).toISOString(),
});

const topics = [{ id: 'topic_loops', name: 'Loops' }] as unknown as Topic[];

// An older untopiced exchange, a topic exchange, then a brand-new conversation.
const log: ChatMessage[] = [
  msg('u1', 'user', 'what is a variable?', 1),
  msg('a1', 'assistant', 'A variable is…', 2),
  msg('u2', 'user', 'how do loops work?', 3),
  msg('a2', 'assistant', 'A loop repeats…', 4),
  msg('u3', 'user', 'explain recursion please', 5),
  msg('a3', 'assistant', 'Recursion is…', 6),
];

// Only the assistant ids are ever recorded — the user message id never comes
// back from the stream, exactly as in the real client.
const topicOf = { a2: 'topic_loops' };
const conversationOf = { a3: 'conv-new' };

describe('buildThreads with conversations', () => {
  const threads = buildThreads(log, topicOf, topics, conversationOf);

  it('keeps a new conversation separate from earlier messages', () => {
    const fresh = findThreadByKey(threads, 'conv-new');
    expect(fresh).toBeDefined();
    expect(fresh?.messages.map((m) => m.id)).toEqual(['u3', 'a3']);
  });

  it('titles the conversation after what was asked in it', () => {
    expect(findThreadByKey(threads, 'conv-new')?.title).toBe('explain recursion please');
  });

  it('leaves the pre-existing untopiced messages as one thread', () => {
    const ungrouped = findThread(threads, null);
    expect(ungrouped?.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('leaves topic threads alone', () => {
    expect(findThread(threads, 'topic_loops')?.messages.map((m) => m.id)).toEqual([
      'u2',
      'a2',
    ]);
  });

  it('does not mistake a conversation for the ungrouped thread', () => {
    expect(findThread(threads, null)?.key).not.toBe('conv-new');
  });

  it('produces one thread per conversation, topic and remainder', () => {
    expect(threads).toHaveLength(3);
  });
});

describe('regression: the reported bug', () => {
  it('a first message in a new chat shows only itself', () => {
    // Before the fix this message landed in the shared untopiced thread and
    // arrived with every earlier untopiced message already in it.
    const threads = buildThreads(log, topicOf, topics, conversationOf);
    const fresh = findThreadByKey(threads, 'conv-new');

    expect(fresh?.messages).toHaveLength(2);
    expect(fresh?.messages.some((m) => m.content.includes('variable'))).toBe(false);
  });
});
