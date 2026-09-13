import { describe, expect, it } from 'vitest';
import {
  LABELS,
  generateQuestionsForTopics,
  passageCharsPerTopic,
  pickAnswerPositions,
  questionOutputTokens,
} from '../../src/modules/agent/questions.js';
import type { JsonRequest, LlmClient } from '../../src/lib/llm.js';
import { estimateReadMinutes } from '../../src/modules/plan/reading-time.js';

describe('pickAnswerPositions', () => {
  it('uses every label once in each run of four', () => {
    // The point is that the correct answer is not always in one slot.
    const positions = pickAnswerPositions(8);

    expect(new Set(positions.slice(0, 4))).toEqual(new Set(LABELS));
    expect(new Set(positions.slice(4, 8))).toEqual(new Set(LABELS));
  });

  it('returns exactly as many positions as questions requested', () => {
    expect(pickAnswerPositions(3)).toHaveLength(3);
    expect(pickAnswerPositions(0)).toEqual([]);
  });

  it('varies with the random source', () => {
    expect(pickAnswerPositions(4, () => 0)).not.toEqual(pickAnswerPositions(4, () => 0.99));
  });
});

describe('estimateReadMinutes', () => {
  it('scales with the lesson the student will actually read', () => {
    expect(estimateReadMinutes('word '.repeat(1500), 3)).toBe(12);
  });

  it('falls back to page count when there is no lesson text', () => {
    expect(estimateReadMinutes('', 3)).toBe(9);
  });

  it('stays within a sensible range', () => {
    expect(estimateReadMinutes('word', 1)).toBe(4);
    expect(estimateReadMinutes('word '.repeat(20_000), 40)).toBe(30);
  });
});

// ─── Batched generation ──────────────────────────────────────────────────────

const budget = { inputChars: 12_000, outputTokens: 3_000 };

describe('request sizing', () => {
  it('reserves output for the questions asked, not the whole budget', () => {
    expect(questionOutputTokens(1, budget)).toBe(1_050);
    expect(questionOutputTokens(10, budget)).toBe(3_000);
  });

  it('splits passage space across topics and caps it at the budget', () => {
    expect(passageCharsPerTopic(1, 1, budget)).toBe(4_500);
    expect(passageCharsPerTopic(5, 5, budget)).toBe(2_400);
  });
});

describe('generateQuestionsForTopics', () => {
  const vocabulary = [
    { tag: 'mix_up_a', label: 'A', description: 'a' },
    { tag: 'mix_up_b', label: 'B', description: 'b' },
    { tag: 'mix_up_c', label: 'C', description: 'c' },
  ];

  const chunk = (page: number, content: string) => ({
    id: `c${page}`,
    page,
    sectionTitle: null,
    content,
    similarity: 1,
  });

  const topics = [
    { topicId: 'state', topicName: 'State', chunks: [chunk(2, 'State lives in a store.')], count: 1 },
    { topicId: 'query', topicName: 'Queries', chunks: [chunk(7, 'useQuery caches by key.')], count: 1 },
  ];

  const question = (topicNumber: number, sourcePage: number, stem: string) => ({
    topicNumber,
    stem,
    options: [
      { label: 'A' as const, text: `${stem} right`, misconceptionTag: null },
      { label: 'B' as const, text: `${stem} wrong 1`, misconceptionTag: 'mix_up_a' },
      { label: 'C' as const, text: `${stem} wrong 2`, misconceptionTag: 'mix_up_b' },
      { label: 'D' as const, text: `${stem} wrong 3`, misconceptionTag: 'mix_up_c' },
    ],
    correctLabel: 'A' as const,
    explanation: 'Because the material says so.',
    sourcePage,
    difficulty: 'beginner' as const,
  });

  function fakeLlm(responses: unknown[]) {
    const calls: JsonRequest<unknown>[] = [];
    const llm: LlmClient = {
      modelId: 'fake',
      available: true,
      budget,
      generateJson: async <T,>(request: JsonRequest<T>) => {
        calls.push(request as JsonRequest<unknown>);
        return { value: (responses.shift() ?? { questions: [] }) as T, usedFallback: false };
      },
      generateText: async () => ({ text: '', usedFallback: false }),
      streamText: async function* () {},
    };
    return { llm, calls };
  }

  it('asks for every topic in one call and attributes each question to its topic', async () => {
    const { llm, calls } = fakeLlm([
      { questions: [question(1, 2, 'Where does state live?'), question(2, 7, 'How is data cached?')] },
    ]);

    const result = await generateQuestionsForTopics({ topics, vocabulary, llm });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain('## Topic 1: State');
    expect(calls[0]!.prompt).toContain('## Topic 2: Queries');
    expect(result.map((q) => [q.topicId, q.sourcePage, q.usedFallback])).toEqual([
      ['state', 2, false],
      ['query', 7, false],
    ]);
  });

  it("discards a question that cites another topic's page, then retries that topic", async () => {
    const { llm, calls } = fakeLlm([
      // Topic 1's question cites page 7, which belongs to topic 2.
      { questions: [question(1, 7, 'Borrowed page'), question(2, 7, 'How is data cached?')] },
      { questions: [question(1, 2, 'Where does state live?')] },
    ]);

    const result = await generateQuestionsForTopics({ topics, vocabulary, llm });

    expect(calls).toHaveLength(2);
    // The retry asks only for the topic still short.
    expect(calls[1]!.prompt).toContain('## Topic 1: State');
    expect(calls[1]!.prompt).not.toContain('Queries');
    expect(result.find((q) => q.topicId === 'state')?.stem).toBe('Where does state live?');
  });
});
