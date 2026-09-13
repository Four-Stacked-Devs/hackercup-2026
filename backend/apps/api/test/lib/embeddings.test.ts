import { describe, expect, it } from 'vitest';
import { buildEmbeddingUpdate, createEmbeddingWorker, type PendingChunk } from '../../src/jobs/embeddings.js';
import { EmbeddingQuotaError, normalise, splitForEmbedding } from '../../src/lib/embeddings.js';
import { RateWindow } from '../../src/lib/rate-window.js';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('buildEmbeddingUpdate', () => {
  it('writes a whole batch, and the model that wrote it, in one statement', () => {
    const { sql, params } = buildEmbeddingUpdate(
      [
        { id: 'a', vector: [0.1, 0.2] },
        { id: 'b', vector: [0.3, 0.4] },
      ],
      'gemini-embedding-001',
    );

    expect(sql.match(/UPDATE/g)).toHaveLength(1);
    expect(sql).toContain('"embeddingModel" = $1');
    expect(sql).toContain('($2::text, $3::text), ($4::text, $5::text)');
    expect(params).toEqual(['gemini-embedding-001', 'a', '[0.1,0.2]', 'b', '[0.3,0.4]']);
  });
});

describe('splitForEmbedding', () => {
  it('keeps every call under the item and token limits, in order', () => {
    const texts = Array.from({ length: 7 }, (_, i) => `${i}`.padEnd(400, 'x')); // ~108 tokens each
    const calls = splitForEmbedding(texts, { maxItems: 3, maxTokens: 250 });

    expect(calls.map((c) => c.texts.length)).toEqual([2, 2, 2, 1]);
    expect(calls.flatMap((c) => c.texts)).toEqual(texts);
    expect(calls.every((c) => c.tokens <= 250)).toBe(true);
  });

  it('sends a text bigger than the call limit on its own rather than dropping it', () => {
    const calls = splitForEmbedding(['a'.repeat(4_000), 'b'], { maxItems: 100, maxTokens: 500 });
    expect(calls.map((c) => c.texts.length)).toEqual([1, 1]);
  });
});

describe('normalise', () => {
  it('scales a truncated vector back to unit length', () => {
    expect(Math.hypot(...normalise([3, 4]))).toBeCloseTo(1);
    expect(normalise([0, 0])).toEqual([0, 0]);
  });
});

describe('RateWindow', () => {
  it('waits for the oldest call to age out once the minute is spent', () => {
    let now = 0;
    const window = new RateWindow({ tpm: 1_000 }, () => now);

    expect(window.tryReserve(600)).toBe(0);
    now = 10_000;
    expect(window.tryReserve(600)).toBeGreaterThan(49_000);
    now = 60_001;
    expect(window.tryReserve(600)).toBe(0);
  });

  it('keeps the rest of the minute for a question when bulk work is paced to a share', () => {
    let now = 0;
    const window = new RateWindow({ tpm: 1_000 }, () => now);

    expect(window.tryReserve(700, 0.8)).toBe(0);
    expect(window.tryReserve(200, 0.8)).toBeGreaterThan(0);
    expect(window.tryReserve(200, 1)).toBe(0);
  });
});

describe('embedding worker', () => {
  /** An in-memory table of chunks, each embedded or not. */
  function fakeTable(ids: string[]) {
    const vectors = new Map<string, number[]>();
    return {
      vectors,
      nextBatch: async (): Promise<PendingChunk[]> =>
        ids.filter((id) => !vectors.has(id)).slice(0, 2).map((id) => ({ id, content: id })),
      save: async (rows: { id: string; vector: number[] }[]) => {
        for (const row of rows) vectors.set(row.id, row.vector);
      },
    };
  }

  it('embeds everything waiting, a batch at a time', async () => {
    const table = fakeTable(['a', 'b', 'c', 'd', 'e']);
    const calls: string[][] = [];
    const worker = createEmbeddingWorker(logger, {
      ...table,
      embed: async (texts) => {
        calls.push(texts);
        return texts.map(() => [1]);
      },
      pausedFor: () => 0,
    });

    worker.kick();
    await worker.onIdle();

    expect([...table.vectors.keys()]).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('picks up passages stored while it was already running', async () => {
    const ids = ['a', 'b'];
    const table = fakeTable(ids);
    let kickDuringRun: (() => void) | null = null;
    const worker = createEmbeddingWorker(logger, {
      ...table,
      // The first check finds nothing; an upload stores passages and kicks meanwhile.
      nextBatch: async () => {
        if (kickDuringRun) {
          const kick = kickDuringRun;
          kickDuringRun = null;
          ids.push('c');
          kick();
          return [];
        }
        return table.nextBatch();
      },
      embed: async (texts) => texts.map(() => [1]),
      pausedFor: () => 0,
    });
    kickDuringRun = () => worker.kick();

    worker.kick();
    await worker.onIdle();

    expect([...table.vectors.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('stops while the quota is spent instead of spinning on it', async () => {
    const table = fakeTable(['a', 'b', 'c']);
    let paused = 0;
    let calls = 0;
    const worker = createEmbeddingWorker(logger, {
      ...table,
      embed: async () => {
        calls += 1;
        paused = 60_000;
        throw new EmbeddingQuotaError(paused);
      },
      pausedFor: () => paused,
    });

    worker.kick();
    await worker.onIdle();

    expect(calls).toBe(1);
    expect(table.vectors.size).toBe(0);
  });

  it('gives up after repeated failures rather than retrying one batch forever', async () => {
    const table = fakeTable(['a', 'b']);
    let calls = 0;
    const worker = createEmbeddingWorker(logger, {
      ...table,
      embed: async () => {
        calls += 1;
        throw new Error('bad request');
      },
      pausedFor: () => 0,
      maxFailures: 3,
    });

    worker.kick();
    await worker.onIdle();

    expect(calls).toBe(3);
  });
});
