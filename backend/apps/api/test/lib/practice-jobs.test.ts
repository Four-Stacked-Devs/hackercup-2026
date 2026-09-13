import { describe, expect, it } from 'vitest';
import { createPracticeWorker } from '../../src/jobs/practice.js';
import { planTopics } from '../../src/services/practice.js';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('planTopics', () => {
  it('spreads a diagnostic across topics in course order', () => {
    expect(planTopics(['a', 'b', 'c', 'd', 'e'], 5).map((p) => p.needed)).toEqual([1, 1, 1, 1, 1]);
    expect(planTopics(['a', 'b'], 5)).toEqual([
      { topic: 'a', needed: 3 },
      { topic: 'b', needed: 2 },
    ]);
  });

  it('stops once the count is covered', () => {
    expect(planTopics(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5)).toHaveLength(5);
  });

  it('gives a single-topic set the whole count', () => {
    expect(planTopics(['only'], 5)).toEqual([{ topic: 'only', needed: 5 }]);
  });
});

describe('practice worker', () => {
  it('fills each set once, however often it is queued', async () => {
    const filled: string[] = [];
    const worker = createPracticeWorker(logger, {
      concurrency: 1,
      fill: async (setId) => {
        filled.push(setId);
        return 'ready';
      },
      markFailed: async () => {},
    });

    worker.enqueue('s1');
    worker.enqueue('s1');
    worker.enqueue('s2');
    await worker.onIdle();

    expect(filled).toEqual(['s1', 's2']);
  });

  it('marks a set FAILED when its job crashes, so the screen stops polling', async () => {
    const failed: string[] = [];
    const worker = createPracticeWorker(logger, {
      concurrency: 1,
      fill: async () => {
        throw new Error('database went away');
      },
      markFailed: async (setId) => {
        failed.push(setId);
      },
    });

    worker.enqueue('s1');
    await worker.onIdle();

    expect(failed).toEqual(['s1']);
  });

  it('can queue a set again after its job finished', async () => {
    let runs = 0;
    const worker = createPracticeWorker(logger, {
      concurrency: 1,
      fill: async () => {
        runs += 1;
        return 'skipped';
      },
      markFailed: async () => {},
    });

    worker.enqueue('s1');
    await worker.onIdle();
    worker.enqueue('s1');
    await worker.onIdle();

    expect(runs).toBe(2);
  });
});
