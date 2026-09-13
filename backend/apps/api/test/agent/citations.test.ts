import { describe, expect, it } from 'vitest';
import {
  MAX_SNIPPET,
  buildSnippet,
  extractCitedPages,
  normalizeCitationMarkers,
} from '../../src/modules/agent/citations.js';
import { citationSchema } from '@educlm/contracts';

/**
 * `Citation.snippet` is capped at 240 characters by the contract, and Fastify's
 * response serializer enforces it — so a snippet one character over is not a
 * cosmetic problem, it is a 500 on the endpoint that produced it.
 */
describe('buildSnippet', () => {
  const parse = (snippet: string) =>
    citationSchema.parse({ chunkId: 'c1', page: 1, sectionTitle: null, snippet });

  it('stays within the cap when there is no space to break on', () => {
    // A URL, a formula, or CJK text: nothing to trim back to, so the old code
    // spent the whole budget and then appended an ellipsis.
    const unbroken = 'a'.repeat(300);

    const snippet = buildSnippet(unbroken);

    expect(snippet.length).toBeLessThanOrEqual(MAX_SNIPPET);
    expect(() => parse(snippet)).not.toThrow();
  });

  it('stays within the cap when the only space is early in the text', () => {
    // A space before 60% of the cut is rejected as a break point, which is the
    // branch that spent the full budget.
    const snippet = buildSnippet(`ab ${'c'.repeat(400)}`);

    expect(snippet.length).toBeLessThanOrEqual(MAX_SNIPPET);
    expect(() => parse(snippet)).not.toThrow();
  });

  it('still breaks on a whole word when it can', () => {
    const words = `${'word '.repeat(80)}end`;

    const snippet = buildSnippet(words);

    expect(snippet.length).toBeLessThanOrEqual(MAX_SNIPPET);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).not.toMatch(/\s…$/);
  });

  it('leaves text that already fits exactly as it is', () => {
    expect(buildSnippet('Short enough.')).toBe('Short enough.');
    expect(buildSnippet('x'.repeat(MAX_SNIPPET))).toHaveLength(MAX_SNIPPET);
  });
});

/**
 * Models cite ranges and lists even when asked for one page per marker, and a
 * marker the parser misses is a source chip the student never sees.
 */
describe('extractCitedPages', () => {
  it('reads single-page markers', () => {
    expect(extractCitedPages('A claim [p.12] and another [p. 3].')).toEqual([3, 12]);
  });

  it('expands ranges, including the non-breaking hyphen models emit', () => {
    expect(extractCitedPages('Setup [p.7-9]')).toEqual([7, 8, 9]);
    expect(extractCitedPages('Caching [p.26\u201133]')).toEqual([26, 27, 28, 29, 30, 31, 32, 33]);
    expect(extractCitedPages('Steps [pp.4\u20135]')).toEqual([4, 5]);
  });

  it('reads comma-separated lists', () => {
    expect(extractCitedPages('See [p.7, 9] and [p.3, p.5]')).toEqual([3, 5, 7, 9]);
  });

  it('does not expand an implausibly wide range', () => {
    expect(extractCitedPages('[p.2-2026]')).toEqual([2]);
  });

  it('ignores brackets that are not page markers', () => {
    expect(extractCitedPages('an array [1, 2, 3] and a note [see above]')).toEqual([]);
  });
});

describe('normalizeCitationMarkers', () => {
  it("rewrites gpt-oss's native markers into the [p.N] form", () => {
    expect(normalizeCitationMarkers('a cache entry\u30101\u2020p.35\u3011.')).toBe('a cache entry[p.35].');
    expect(extractCitedPages('shared\u30102\u2020p.38\u3011 and \u3010p.4\u3011')).toEqual([4, 38]);
  });

  it('leaves markers that carry no page alone', () => {
    expect(normalizeCitationMarkers('see \u30101\u2020L10-L20\u3011')).toBe('see \u30101\u2020L10-L20\u3011');
  });
});
