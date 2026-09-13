import { describe, expect, it } from 'vitest';
import type { PlanStep } from '@educlm/contracts';
import { buildTopicTemplate, tidyTopicName } from '../../src/modules/ingestion/topic-template.js';
import { buildPlanModules, type ModuleTopic } from '../../src/modules/plan/modules.js';
import {
  pageRange,
  practiceStepDescription,
  readStepDescription,
} from '../../src/modules/plan/template.js';

describe('buildTopicTemplate', () => {
  const name = 'Persisting the auth store';

  it('keeps the model answer, tidied and clamped to the template', () => {
    const template = buildTopicTemplate({
      name,
      objectives: ['  Explain how persist works.  ', '- Write a store that survives a reload;', 'Name the options', 'A fourth one'],
      keyTerms: ['persist', 'partialize', 'localStorage', 'zustand', 'store', 'middleware', 'seventh'],
    });

    expect(template.objectives).toEqual([
      'Explain how persist works',
      'Write a store that survives a reload',
      'Name the options',
    ]);
    expect(template.keyTerms).toHaveLength(6);
    expect(template.keyTerms[0]).toBe('persist');
  });

  it('drops duplicates whatever their case', () => {
    const template = buildTopicTemplate({
      name,
      objectives: ['Explain persist', 'explain persist'],
      keyTerms: ['Persist', 'persist', 'partialize', 'zustand'],
    });

    expect(template.objectives).toEqual([
      'Explain persist',
      'Explain the main ideas of Persisting the auth store',
    ]);
    expect(template.keyTerms).toEqual(['Persist', 'partialize', 'zustand']);
  });

  it('fills a topic the model said nothing about with verb-first outcomes', () => {
    // A summary sentence would read as nonsense after "you should be able to".
    const template = buildTopicTemplate({
      name: 'Common ethical theories',
      passages: [
        {
          content:
            'Every society should often agree on rules. Utilitarianism judges actions by outcomes. ' +
            'Deontology judges actions by duties. Utilitarianism and Deontology often disagree.',
        },
      ],
    });

    expect(template.objectives).toEqual([
      'Explain the main ideas of Common ethical theories',
      'Answer practice questions on Common ethical theories from memory',
    ]);
    expect(template.keyTerms).toContain('Utilitarianism');
    expect(template.keyTerms).toContain('Deontology');
    // Ordinary words and the topic's own name are not key terms.
    expect(template.keyTerms).not.toContain('should');
    expect(template.keyTerms).not.toContain('often');
    expect(template.keyTerms.map((t) => t.toLowerCase())).not.toContain('ethical');
  });

  it('does not list the topic name as its own key term, singular or plural', () => {
    const template = buildTopicTemplate({
      name: 'Variables',
      passages: [{ content: 'A variable stores a value. Declare the variable with let or const keywords.' }],
    });

    expect(template.keyTerms.map((t) => t.toLowerCase())).not.toContain('variable');
  });

  it('ignores capitals in headings and merges plurals', () => {
    const template = buildTopicTemplate({
      name: 'Computer ethics',
      passages: [
        {
          content:
            'Thou Shalt Not Use A Computer To Harm\n' +
            'Programmers write software that affects users. A programmer owes users honesty.\n' +
            'Software can harm users when programmers ignore privacy.',
        },
      ],
    });

    expect(template.keyTerms).not.toContain('Shalt');
    expect(template.keyTerms).not.toContain('Thou');
    const lower = template.keyTerms.map((t) => t.toLowerCase());
    expect(lower.filter((t) => t.startsWith('programmer'))).toHaveLength(1);
  });

  it('truncates an objective that runs on, on a word boundary', () => {
    const template = buildTopicTemplate({ name, objectives: [`Explain ${'word '.repeat(40)}`] });

    expect(template.objectives[0]!.length).toBeLessThanOrEqual(120);
    expect(template.objectives[0]).not.toMatch(/\s$/);
  });
});

describe('tidyTopicName', () => {
  it.each([
    ['1. Subjective Relativism', 'Subjective Relativism'],
    ['a. Invisible Abuse', 'Invisible Abuse'],
    ['IV) Findings', 'Findings'],
    ['(2) Methods', 'Methods'],
    ['Module 1', 'Module 1'],
    ['Fetching data with useQuery', 'Fetching data with useQuery'],
  ])('%s → %s', (raw, tidy) => {
    expect(tidyTopicName(raw)).toBe(tidy);
  });
});

describe('step wording', () => {
  const topic = {
    name: 'Fetching data with useQuery',
    summary: 'How queries work.',
    sourcePages: [30, 31, 32, 34],
    objectives: ['Explain what a queryKey identifies', 'Replace useEffect fetching'],
    keyTerms: ['queryKey', 'queryFn'],
  };

  it('writes page ranges the way a student would', () => {
    expect(pageRange([30, 31, 32, 34])).toBe('30–32, 34');
    expect(pageRange([7])).toBe('7');
    expect(pageRange([])).toBe('');
  });

  it('says where to read and what to look for', () => {
    expect(readStepDescription(topic)).toBe(
      'Study notes for pp. 30–32, 34. Focus on: queryKey, queryFn.',
    );
  });

  it('turns the first outcome into the practice goal', () => {
    expect(practiceStepDescription(topic, 5)).toBe(
      '5 questions. Afterwards you should be able to explain what a queryKey identifies.',
    );
  });

  it('leaves an identifier capitalised as the material writes it', () => {
    const api = { ...topic, objectives: ['useQuery replaces useEffect fetching'] };
    expect(practiceStepDescription(api, 5)).toContain('able to useQuery replaces');
  });

  it('still reads as a sentence for a topic with no outcomes', () => {
    const bare = { ...topic, objectives: [], keyTerms: [] };
    expect(readStepDescription(bare)).toBe('Study notes for pp. 30–32, 34.');
    expect(practiceStepDescription(bare, 5)).toBe(
      '5 questions. Checks what you took from Fetching data with useQuery.',
    );
  });
});

describe('buildPlanModules', () => {
  const topics: ModuleTopic[] = [
    { id: 't1', name: 'State', summary: 's', orderIndex: 0, sourcePages: [1], objectives: [], keyTerms: [], lessonStatus: 'ready' },
    { id: 't2', name: 'Queries', summary: 's', orderIndex: 1, sourcePages: [2], objectives: [], keyTerms: [], lessonStatus: 'draft' },
  ];

  const step = (over: Partial<PlanStep> & { id: string }): PlanStep => ({
    kind: 'read',
    title: 'Read',
    description: '',
    topicId: 't1',
    target: null,
    estimatedMinutes: 8,
    status: 'pending',
    orderIndex: 0,
    insertedByAdaptation: false,
    ...over,
  });

  it('groups steps under their topic in course order', () => {
    const modules = buildPlanModules(
      [
        step({ id: 'b', topicId: 't2', kind: 'practice', orderIndex: 3 }),
        step({ id: 'a', topicId: 't1', orderIndex: 0 }),
      ],
      topics,
    );

    expect(modules.map((m) => m.topicName)).toEqual(['State', 'Queries']);
    expect(modules[0]!.stepIds).toEqual(['a']);
    expect(modules[1]!.lessonStatus).toBe('draft');
  });

  it('orders a module read, practise, then whatever EDU added', () => {
    const modules = buildPlanModules(
      [
        step({ id: 'review', kind: 'review', insertedByAdaptation: true, orderIndex: 0 }),
        step({ id: 'practice', kind: 'practice', orderIndex: 9 }),
        step({ id: 'read', kind: 'read', orderIndex: 8 }),
      ],
      topics,
    );

    expect(modules[0]!.stepIds).toEqual(['read', 'practice', 'review']);
  });

  it('counts progress with skipped steps out of both sides', () => {
    const modules = buildPlanModules(
      [
        step({ id: 'a', status: 'completed', estimatedMinutes: 8 }),
        step({ id: 'b', status: 'skipped', estimatedMinutes: 6 }),
        step({ id: 'c', kind: 'practice', status: 'pending', estimatedMinutes: 6 }),
      ],
      topics,
    );

    expect(modules[0]).toMatchObject({
      completedSteps: 1,
      totalSteps: 2,
      estimatedMinutes: 6,
      status: 'in_progress',
    });
  });

  it('marks a module done only when every step it still owns is done', () => {
    const modules = buildPlanModules(
      [step({ id: 'a', status: 'completed' }), step({ id: 'b', status: 'skipped' })],
      topics,
    );

    expect(modules[0]!.status).toBe('completed');
  });

  it('keeps a step whose topic is gone in a trailing module', () => {
    const modules = buildPlanModules([step({ id: 'x', topicId: null })], topics);

    expect(modules.at(-1)).toMatchObject({ topicId: null, topicName: 'General', stepIds: ['x'] });
  });

  it('leaves out a topic with no steps', () => {
    expect(buildPlanModules([step({ id: 'a', topicId: 't1' })], topics)).toHaveLength(1);
  });
});
