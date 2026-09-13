import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PracticeSet } from '@educlm/contracts';
import { GeneratingView } from './practice-runner';

const set = (questions: number): PracticeSet => ({
  id: 's1',
  materialId: 'm1',
  topicId: null,
  topicName: null,
  kind: 'diagnostic',
  status: 'generating',
  reason: null,
  questions: Array.from({ length: questions }, (_, i) => ({
    id: `q${i}`,
    topicId: 't1',
    topicName: 'Topic',
    stem: 'Stem',
    options: [],
    difficulty: 'beginner',
    sourcePage: 1,
  })) as unknown as PracticeSet['questions'],
  targetCount: 5,
  answeredCount: 0,
  createdAt: new Date().toISOString(),
  completedAt: null,
});

describe('GeneratingView', () => {
  it('shows a spinner, what is being built, and a practice tip', () => {
    const html = renderToStaticMarkup(createElement(GeneratingView, { set: set(0) }));

    expect(html).toContain('Building your questions');
    expect(html).toContain('animate-spin');
    expect(html).toContain('writing 5 questions');
    expect(html).toContain('Answering from memory');
    // Nothing is ready yet, so no "0 of 5" count.
    expect(html).not.toMatch(/0(<!-- -->)? of/);
  });

  it('counts the questions that are already ready', () => {
    const html = renderToStaticMarkup(createElement(GeneratingView, { set: set(2) }));
    expect(html.replace(/<!-- -->/g, '')).toContain('2 of 5 ready');
  });
});
