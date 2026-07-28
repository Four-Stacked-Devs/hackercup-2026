import { z } from 'zod';
import type { SectionKind } from '@educlm/contracts';
import type { LlmClient } from '../../lib/llm.js';
import type { ChunkDraft } from './chunk.js';

/**
 * Accessible lesson building.
 *
 * The transformation is a REFORMAT, not a rewrite: clean headings, short
 * paragraphs, plain sentences, preserved lists. Do not invent content.
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
        level: z.union([z.literal(2), z.literal(3)]).default(2),
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

const SYSTEM = `You reformat textbook passages into accessible lesson sections for a
high-school student who may have a reading difficulty.

Absolute rules:
- REFORMAT ONLY. Never add facts, examples, or explanations that are not in the
  source text. This is not a rewrite and not a summary of your own knowledge.
- Keep every technical term the source uses.
- Short paragraphs (2-4 sentences). Plain sentences. Active voice.
- Preserve lists as markdown lists. Preserve code as fenced code blocks.
- If a passage is a table or an equation, reproduce it as faithfully as you can
  and do not attempt to explain it away.
- sourcePages must come from the page numbers given to you.
- Headings should be the material's own headings where they exist.`;

export async function buildLessonSections(
  topicName: string,
  chunks: ChunkDraft[],
  llm: LlmClient,
): Promise<{ sections: SectionDraft[]; usedFallback: boolean }> {
  if (chunks.length === 0) return { sections: [], usedFallback: true };

  const validPages = new Set(chunks.map((c) => c.page));

  const source = chunks
    .map((c) => `[p.${c.page}]${c.sectionTitle ? ` (${c.sectionTitle})` : ''}\n${c.content}`)
    .join('\n\n---\n\n')
    .slice(0, 16_000);

  const { value, usedFallback } = await llm.generateJson({
    schema: llmLessonSchema,
    system: SYSTEM,
    prompt: `Topic: ${topicName}\n\nSource passages:\n\n${source}`,
    retries: 1,
    maxOutputTokens: 4000,
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
