import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ANALYTICS_DIR = fileURLToPath(
  new URL('../../src/modules/analytics', import.meta.url),
);

function analyticsSources(): { file: string; source: string }[] {
  return readdirSync(ANALYTICS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, source: readFileSync(join(ANALYTICS_DIR, file), 'utf8') }));
}

/**
 * The rule that defines this project: the analytics engine never asks a
 * language model what the student is weak at, and never reaches for I/O.
 *
 * This is enforced mechanically rather than by convention, because "how does it
 * know?" must always be answerable by pointing at a function.
 */
describe('analytics engine purity', () => {
  const banned: { pattern: RegExp; why: string }[] = [
    { pattern: /from\s+['"]@prisma\//, why: 'imports Prisma' },
    { pattern: /from\s+['"].*generated\/prisma/, why: 'imports the generated Prisma client' },
    { pattern: /\bprisma\./, why: 'uses a prisma client' },
    { pattern: /\bfetch\s*\(/, why: 'performs network I/O' },
    { pattern: /from\s+['"]ai['"]/, why: 'imports the Vercel AI SDK' },
    { pattern: /from\s+['"]@ai-sdk\//, why: 'imports an AI SDK provider' },
    { pattern: /generateText|streamText|generateObject|embed\s*\(/, why: 'calls an LLM' },
    { pattern: /from\s+['"]node:fs['"]/, why: 'reads the filesystem' },
    { pattern: /require\s*\(/, why: 'uses dynamic require' },
  ];

  it('finds source files to check', () => {
    expect(analyticsSources().length).toBeGreaterThan(0);
  });

  for (const { pattern, why } of banned) {
    it(`never ${why}`, () => {
      const offenders = analyticsSources()
        .filter(({ source }) => pattern.test(stripComments(source)))
        .map(({ file }) => file);

      expect(offenders, `analytics/${offenders.join(', ')} ${why}`).toEqual([]);
    });
  }

  it('takes time as an argument rather than reading the clock', () => {
    // Date.now() / new Date() with no argument would make findings depend on
    // wall-clock time and become untestable. `now` is always injected.
    const offenders = analyticsSources()
      .filter(({ source }) => /Date\.now\(\)|new Date\(\s*\)/.test(stripComments(source)))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

/** Crude but sufficient: keeps prose in doc comments from tripping the checks. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
