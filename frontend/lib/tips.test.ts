import { describe, expect, it } from 'vitest';
import { tipsFor, type TipTopic } from './tips';

const TOPICS: TipTopic[] = ['upload', 'lesson', 'practice', 'plan', 'chat'];

describe('tipsFor', () => {
  it.each(TOPICS)('has several distinct tips for %s, so rotation shows something new', (topic) => {
    const tips = tipsFor(topic);
    expect(tips.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tips).size).toBe(tips.length);
  });

  it('keeps every tip to one readable sentence or two', () => {
    for (const topic of TOPICS) {
      for (const tip of tipsFor(topic)) expect(tip.length).toBeLessThanOrEqual(160);
    }
  });
});
