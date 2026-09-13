import { describe, expect, it } from 'vitest';
import { MAX_SNIPPET, buildSnippet } from '../../src/modules/agent/citations.js';
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
