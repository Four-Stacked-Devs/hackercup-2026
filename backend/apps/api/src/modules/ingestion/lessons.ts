import { z } from 'zod';
import type { SectionKind } from '@educlm/contracts';
import type { LlmClient } from '../../lib/llm.js';
import type { ChunkDraft } from './chunk.js';

/**
 * Accessible lesson building.
 *
 * The model writes study notes that explain the source — short paragraphs,
 * plain sentences, defined terms, key takeaways — without adding facts the
 * source does not contain.
 *
 * Tables and equations are marked `needsReview` and keep their source page, so
 * the student is told to check the original rather than being handed a
 * confident mangling of a table.
 */

export interface SectionDraft {
  heading: string;
  level: 2 | 3;
  bodyMarkdown: string;
  orderIndex: number;
  sourcePages: number[];
  kind: SectionKind;
  needsReview: boolean;
}

const llmLessonSchema = z.object({
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(160),
        // A plain required integer: Gemini's schema subset only allows string
        // enums, Groq's strict mode rejects defaulted (optional) properties,
        // and the mapping below clamps it to 2 or 3 anyway.
        level: z.number().int(),
        bodyMarkdown: z.string().min(1),
        sourcePages: z.array(z.number().int().positive()).min(1),
      }),
    )
    .min(1)
    .max(20),
});

// ─── Content classification ──────────────────────────────────────────────────

export function looksLikeTable(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;

  const pipeRows = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2).length;
  if (pipeRows >= 2) return true;

  // Columnar layout: several lines with 2+ wide whitespace gaps.
  const columnar = lines.filter((l) => (l.match(/\s{3,}/g) ?? []).length >= 2).length;
  return columnar >= Math.max(2, Math.floor(lines.length * 0.5));
}

export function looksLikeEquation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 400) return false;

  if (/[∑∫√≤≥≠±×÷π∞Δ]/.test(trimmed)) return true;

  const mathChars = (trimmed.match(/[=+\-*/^()]/g) ?? []).length;
  const letters = (trimmed.match(/[a-z]/gi) ?? []).length;

  return mathChars >= 3 && mathChars > letters * 0.25;
}

export function looksLikeFigure(text: string): boolean {
  return /^\s*(figure|fig\.|diagram|illustration|table)\s*\d+/i.test(text);
}

export function classifySection(text: string): { kind: SectionKind; needsReview: boolean } {
  if (looksLikeFigure(text)) return { kind: 'figure_description', needsReview: true };
  if (looksLikeTable(text)) return { kind: 'table', needsReview: true };
  if (looksLikeEquation(text)) return { kind: 'equation', needsReview: true };
  return { kind: 'text', needsReview: false };
}

// ─── Deterministic fallback ──────────────────────────────────────────────────

/**
 * Structural reformat with no model involved: reuse the document's own
 * headings, normalise spacing, and convert obvious bullet markers to markdown.
 * Every character of body text comes from the source.
 */
export function buildSectionsStructurally(chunks: ChunkDraft[]): SectionDraft[] {
  const groups = new Map<string, ChunkDraft[]>();

  for (const chunk of chunks) {
    const key = chunk.sectionTitle ?? 'Overview';
    const list = groups.get(key);
    if (list) list.push(chunk);
    else groups.set(key, [chunk]);
  }

  return [...groups.entries()].map(([heading, items], orderIndex) => {
    const body = items.map((c) => tidyMarkdown(c.content)).join('\n\n');
    const { kind, needsReview } = classifySection(body);

    return {
      heading,
      level: 2 as const,
      bodyMarkdown: body,
      orderIndex,
      sourcePages: [...new Set(items.map((c) => c.page))].sort((a, b) => a - b),
      kind,
      needsReview,
    };
  });
}

/** Light markdown tidy-up. Never rewords. */
export function tidyMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      // Normalise common PDF bullet glyphs to markdown list items.
      if (/^[•·▪◦‣]\s+/.test(trimmed)) return trimmed.replace(/^[•·▪◦‣]\s+/, '- ');
      if (/^[-–—]\s+/.test(trimmed)) return trimmed.replace(/^[-–—]\s+/, '- ');
      return trimmed;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── LLM path ────────────────────────────────────────────────────────────────

/**
 * Explain, don't embellish. A pure reformat of a slide deck hands the student
 * the same terse bullets they already could not learn from, so the model may
 * unpack what the source says — but every fact still has to come from it.
 */
const SYSTEM = `You turn one topic from a student's own course material into clear study
notes they can learn from. The source is often terse — lecture slides, bullet
points, code snippets — and your job is to make it understandable.

GROUNDING
- Every fact, definition, rule, and example must come from the source passages.
- You MAY explain and connect what the source says: spell out what a bullet
  point means, why a step matters, how two ideas relate, what a code snippet
  does line by line.
- You may NOT introduce facts, features, APIs, or topics the source does not
  contain. If the source is thin on something, keep that part short.
- Keep every technical term the source uses and define it in plain words the
  first time it appears.
- Reproduce code exactly, in fenced code blocks with a language tag, then
  explain it. Reproduce tables and equations faithfully, then say what they show.

STRUCTURE — sections in this order
1. "What this topic is about": 2-3 sentences on what it covers and why it
   matters in this material.
2. One section per key idea, using the material's own headings where they
   exist. Explain in short paragraphs and bullet lists. Bold each key term on
   first use.
3. If the source has examples or code, a section that walks through them.
4. "Key takeaways": 3-6 bullets a student could revise from the night before a
   test.

STYLE
- Plain sentences, active voice, one idea per sentence, paragraphs of 2-4
  sentences. Write for a student who may find reading hard.
- Markdown in bodyMarkdown (bold, lists, code fences). Never put a heading
  inside bodyMarkdown; the heading field carries it.
- level is 2 for a main section, 3 for a sub-section of the one before it.
- sourcePages: the page numbers each section draws on, only from those given.
  The opening and takeaways list every page they summarise.`;

export async function buildLessonSections(
  topicName: string,
  chunks: ChunkDraft[],
  llm: LlmClient,
  topicSummary?: string,
): Promise<{ sections: SectionDraft[]; usedFallback: boolean }> {
  if (chunks.length === 0) return { sections: [], usedFallback: true };

  const validPages = new Set(chunks.map((c) => c.page));

  const source = chunks
    .map((c) => `[p.${c.page}]${c.sectionTitle ? ` (${c.sectionTitle})` : ''}\n${c.content}`)
    .join('\n\n---\n\n')
    .slice(0, llm.budget.inputChars);

  const { value, usedFallback } = await llm.generateJson({
    schema: llmLessonSchema,
    system: SYSTEM,
    prompt: `Topic: ${topicName}${topicSummary ? `\nWhat it covers: ${topicSummary}` : ''}\n\nSource passages:\n\n${source}`,
    retries: 1,
    maxOutputTokens: llm.budget.outputTokens,
    fallback: () => ({
      sections: buildSectionsStructurally(chunks).map((s) => ({
        heading: s.heading,
        level: s.level,
        bodyMarkdown: s.bodyMarkdown,
        sourcePages: s.sourcePages,
      })),
    }),
  });

  const sections = value.sections.map((section, orderIndex) => {
    const pages = section.sourcePages.filter((p) => validPages.has(p));
    const { kind, needsReview } = classifySection(section.bodyMarkdown);

    return {
      heading: section.heading,
      level: (section.level === 3 ? 3 : 2) as 2 | 3,
      bodyMarkdown: section.bodyMarkdown,
      orderIndex,
      // Never leave a section unattributed: fall back to the topic's pages.
      sourcePages:
        pages.length > 0 ? pages : [...new Set(chunks.map((c) => c.page))].sort((a, b) => a - b),
      kind,
      needsReview,
    };
  });

  if (sections.length === 0) {
    return { sections: buildSectionsStructurally(chunks), usedFallback: true };
  }

  return { sections, usedFallback };
}
