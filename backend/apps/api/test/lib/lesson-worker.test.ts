import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLessonWorker } from '../../src/jobs/lessons.js';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A worker whose jobs are recorded and released by hand. */
function harness(topicIds: string[], bankTopicIds: string[] = [], concurrency = 1) {
  const order: string[] = [];
  const releases: (() => void)[] = [];
  const events: string[] = [];

  const held = <T>(label: string, value: T) =>
    new Promise<T>((resolve) => {
      order.push(label);
      events.push(label);
      releases.push(() => resolve(value));
    });

  const worker = createLessonWorker(logger, {
    concurrency,
    loadWork: async () => ({ userId: 'u1', topicIds, bankTopicIds }),
    prebuildPlan: async () => {
      events.push('plan');
    },
    writeStudyNotes: (topicId) => held(topicId, 'ready' as const),
    stockBank: (topicId) => held(`bank:${topicId}`, 'stocked' as const),
  });

  const releaseAll = async () => {
    for (let i = 0; i < 20; i += 1) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  return { worker, order, events, releaseAll };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('background worker', () => {
  it('builds the plan, writes lessons in course order, then stocks question banks', async () => {
    const { worker, events, releaseAll } = harness(['t1', 't2'], ['t1', 't2']);

    await worker.enqueueMaterial('m1');
    await tick();
    await releaseAll();
    await worker.onIdle();

    expect(events).toEqual(['plan', 't1', 't2', 'bank:t1', 'bank:t2']);
  });

  it('moves the topic a student opens to the front, ahead of banks too', async () => {
    const { worker, order, releaseAll } = harness(['t1', 't2', 't3', 't4'], ['t1']);

    await worker.enqueueMaterial('m1');
    await tick();
    // t1 is already being written; the student opens t4.
    worker.prioritize('t4');
    await releaseAll();
    await worker.onIdle();

    expect(order).toEqual(['t1', 't4', 't2', 't3', 'bank:t1']);
  });

  it('never queues the same job twice', async () => {
    const { worker, order, releaseAll } = harness(['t1', 't2']);

    await worker.enqueueMaterial('m1');
    await tick();
    worker.prioritize('t1'); // being written
    worker.prioritize('t2'); // already waiting
    worker.prioritize('t2');
    await releaseAll();
    await worker.onIdle();

    expect(order).toEqual(['t1', 't2']);
  });

  it('queues a topic it had not been told about when it is opened', async () => {
    // After a restart, before recovery has run: the open still gets it written.
    const { worker, order, releaseAll } = harness([]);

    worker.prioritize('orphan');
    await tick();
    await releaseAll();
    await worker.onIdle();

    expect(order).toEqual(['orphan']);
  });

  it('keeps going when one job fails', async () => {
    const done: string[] = [];
    const worker = createLessonWorker(logger, {
      concurrency: 1,
      loadWork: async () => ({ userId: 'u1', topicIds: ['bad', 'good'], bankTopicIds: ['good'] }),
      prebuildPlan: async () => {},
      writeStudyNotes: async (topicId) => {
        if (topicId === 'bad') throw new Error('topic deleted mid-write');
        done.push(topicId);
        return 'ready';
      },
      stockBank: async (topicId) => {
        done.push(`bank:${topicId}`);
        return 'stocked';
      },
    });

    await worker.enqueueMaterial('m1');
    await worker.onIdle();

    expect(done).toEqual(['good', 'bank:good']);
  });

  it('does nothing for a material that is not ready', async () => {
    const worker = createLessonWorker(logger, {
      loadWork: async () => null,
      prebuildPlan: async () => {
        throw new Error('should not plan');
      },
      writeStudyNotes: async () => {
        throw new Error('should not write');
      },
      stockBank: async () => {
        throw new Error('should not stock');
      },
    });

    await worker.enqueueMaterial('m1');
    await worker.onIdle();
    expect(worker.pending).toBe(0);
  });
});

describe('background worker while the provider is out of quota', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parks every job until the reset, then runs them', async () => {
    vi.useFakeTimers();
    let paused = 60_000;
    const done: string[] = [];

    const worker = createLessonWorker(logger, {
      concurrency: 1,
      pausedFor: () => paused,
      loadWork: async () => ({ userId: 'u1', topicIds: ['t1'], bankTopicIds: ['t1'] }),
      prebuildPlan: async () => {},
      writeStudyNotes: async (topicId) => {
        done.push(topicId);
        return 'ready';
      },
      stockBank: async (topicId) => {
        done.push(`bank:${topicId}`);
        return 'stocked';
      },
    });

    await worker.enqueueMaterial('m1');
    await worker.onIdle();
    // Nothing written from the fallback while the quota is spent.
    expect(done).toEqual([]);

    paused = 0;
    await vi.advanceTimersByTimeAsync(62_000);
    await worker.onIdle();

    expect(done).toEqual(['t1', 'bank:t1']);
  });

  it('retries a job that ran out of quota mid-call', async () => {
    vi.useFakeTimers();
    const outcomes = ['deferred', 'ready'] as const;
    const attempts: string[] = [];

    const worker = createLessonWorker(logger, {
      concurrency: 1,
      pausedFor: () => 0,
      loadWork: async () => ({ userId: 'u1', topicIds: ['t1'], bankTopicIds: [] }),
      prebuildPlan: async () => {},
      writeStudyNotes: async () => {
        const outcome = outcomes[attempts.length]!;
        attempts.push(outcome);
        return outcome;
      },
      stockBank: async () => 'skipped',
    });

    await worker.enqueueMaterial('m1');
    await worker.onIdle();
    expect(attempts).toEqual(['deferred']);

    await vi.advanceTimersByTimeAsync(32_000);
    await worker.onIdle();
    expect(attempts).toEqual(['deferred', 'ready']);
  });
});
