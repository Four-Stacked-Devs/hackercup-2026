/**
 * Copies the backend's demo seed into a JSON fixture the mock layer reads.
 *
 * Mock mode has to look identical to live mode, which means identical ids and
 * identical content. Rather than retyping the seed by hand (and drifting from
 * it), this reads the seed modules directly and writes what it finds.
 *
 * Run:  npm run fixtures
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, '../../backend/apps/api/prisma');

const { DEMO_MATERIAL, DEMO_TOPICS, DEMO_VOCABULARY } = await import(
  resolve(seedDir, 'seed-content.ts')
);
const { DEMO_QUESTIONS } = await import(resolve(seedDir, 'seed-questions.ts'));

// Mirrors apps/api/src/modules/ingestion/lessons.ts, so a fixture section is
// flagged needsReview exactly where a real ingested section would be.
function looksLikeTable(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  const pipeRows = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2).length;
  if (pipeRows >= 2) return true;
  const columnar = lines.filter((l) => (l.match(/\s{3,}/g) ?? []).length >= 2).length;
  return columnar >= Math.max(2, Math.floor(lines.length * 0.5));
}

function looksLikeEquation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 400) return false;
  if (/[∑∫√≤≥≠±×÷π∞Δ]/.test(trimmed)) return true;
  const mathChars = (trimmed.match(/[=+\-*/^()]/g) ?? []).length;
  const letters = (trimmed.match(/[a-z]/gi) ?? []).length;
  return mathChars >= 3 && mathChars > letters * 0.25;
}

function looksLikeFigure(text: string): boolean {
  return /^\s*(figure|fig\.|diagram|illustration|table)\s*\d+/i.test(text);
}

function classify(text: string): { kind: string; needsReview: boolean } {
  if (looksLikeFigure(text)) return { kind: 'figure_description', needsReview: true };
  if (looksLikeTable(text)) return { kind: 'table', needsReview: true };
  if (looksLikeEquation(text)) return { kind: 'equation', needsReview: true };
  return { kind: 'text', needsReview: false };
}

interface SeedPage {
  heading: string;
  body: string;
}

interface SeedTopic {
  id: string;
  slug: string;
  name: string;
  summary: string;
  firstPage: number;
  lastPage: number;
  prerequisiteSlugs: string[];
  pages: SeedPage[];
}

const fixture = {
  generatedFrom: 'backend/apps/api/prisma/seed-content.ts + seed-questions.ts',
  material: DEMO_MATERIAL,
  vocabulary: DEMO_VOCABULARY,
  topics: (DEMO_TOPICS as SeedTopic[]).map((topic) => ({
    ...topic,
    pages: topic.pages.map((page) => ({ ...page, ...classify(page.body) })),
  })),
  questions: DEMO_QUESTIONS,
};

const out = resolve(here, '../mocks/fixtures/seed.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(
  `wrote ${out}: ${fixture.topics.length} topics, ${fixture.questions.length} questions`,
);
