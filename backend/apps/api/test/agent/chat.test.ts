import { describe, expect, it } from 'vitest';
import { buildContext, classifyIntent, retrievalQuery } from '../../src/modules/agent/chat.js';
import { toMessages } from '../../src/lib/llm.js';

describe('classifyIntent', () => {
  it.each([
    'summarize this pdf',
    'Summarise the document',
    'can you summarize this',
    'give me a summary',
    'Give me a quick overview of the slides',
    'tl;dr',
    "what's this pdf about?",
    'what is the lecture about',
    'what does this module cover?',
    'what are the main points',
    'recap please',
  ])('treats "%s" as a request for an overview', (message) => {
    expect(classifyIntent(message)).toBe('overview');
  });

  it.each([
    // Names a subject: similarity search over that subject is the right tool.
    'summarize how useEffect cleans up',
    'give me a summary of the dependency array rules',
    'what is state?',
    'Explain that again more simply, as if I am new to it.',
    'what does useState return?',
  ])('keeps "%s" on the grounded material path', (message) => {
    expect(classifyIntent(message)).toBe('material');
  });

  it('still recognises greetings and capability questions first', () => {
    expect(classifyIntent('hi')).toBe('greeting');
    expect(classifyIntent('what can you do?')).toBe('capability');
  });
});

describe('retrievalQuery', () => {
  const history = [
    { role: 'user' as const, content: 'What does useEffect do?' },
    { role: 'assistant' as const, content: 'It runs side effects after render [p.4].' },
  ];

  it('searches the previous question too when the message only makes sense against it', () => {
    // The chip text: on its own it matches nothing about useEffect.
    const query = retrievalQuery('Explain that again more simply, as if I am new to it.', history);
    expect(query).toContain('What does useEffect do?');
  });

  it('leaves a self-contained question alone', () => {
    expect(retrievalQuery('What is the dependency array in useEffect used for?', history)).toBe(
      'What is the dependency array in useEffect used for?',
    );
  });

  it('has nothing to add on the first turn', () => {
    expect(retrievalQuery('Show me another example', [])).toBe('Show me another example');
  });
});

describe('toMessages', () => {
  it('appends the new message after the history', () => {
    const messages = toMessages({
      history: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
      prompt: 'q2',
    });

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('merges consecutive user turns left by an answer that failed to save', () => {
    // Gemini and Anthropic reject two user turns in a row outright.
    const messages = toMessages({ history: [{ role: 'user', content: 'q1' }], prompt: 'q2' });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'q1\n\nq2' });
  });

  it('drops an assistant turn the history window opened on', () => {
    const messages = toMessages({
      history: [
        { role: 'assistant', content: 'a0' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
      prompt: 'q2',
    });

    expect(messages[0]?.role).toBe('user');
    expect(messages).toHaveLength(3);
  });
});

describe('buildContext', () => {
  const chunk = (page: number, content: string) => ({
    id: `c${page}`,
    page,
    sectionTitle: null,
    content,
    similarity: 1,
  });

  it('stops adding passages at the budget', () => {
    const context = buildContext([chunk(1, 'a'.repeat(100)), chunk(2, 'b'.repeat(100))], 150);

    expect(context).toContain('p.1');
    expect(context).not.toContain('p.2');
  });

  it('always keeps the best passage, even when it alone exceeds the budget', () => {
    expect(buildContext([chunk(1, 'a'.repeat(500))], 100)).toContain('p.1');
  });
});
