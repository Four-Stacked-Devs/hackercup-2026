import { z } from 'zod';
import type { LlmClient } from '../../lib/llm.js';
import type { ChunkDraft } from './chunk.js';

/**
 * Topic extraction — one LLM call over headings and chunk openings.
 *
 * If the model is unavailable or returns unusable JSON twice, we fall back to
 * heading-based segmentation. Ingestion never hard-fails on an LLM hiccup.
 */

export interface TopicDraft {
  name: string;
  slug: string;
  summary: string;
  sourcePages: number[];
  prerequisiteSlugs: string[];
}

const MAX_TOPICS = 12;
const MIN_TOPICS = 1;

const llmTopicSchema = z.object({
  topics: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        summary: z.string().min(1).max(600),
        sourcePages: z.array(z.number().int().positive()).min(1),
        prerequisiteSlugs: z.array(z.string()).default([]),
      }),
    )
    .min(MIN_TOPICS)
    .max(MAX_TOPICS),
});

export function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : 'topic';
}

/** Ensure slugs are unique within a material. */
function dedupeSlugs(topics: TopicDraft[]): TopicDraft[] {
  const seen = new Map<string, number>();

  return topics.map((topic) => {
    const count = seen.get(topic.slug) ?? 0;
    seen.set(topic.slug, count + 1);
    return count === 0 ? topic : { ...topic, slug: `${topic.slug}_${count + 1}` };
  });
}

/**
 * Deterministic segmentation from detected headings.
 *
 * This is both the no-API-key path and the LLM-failure path. It produces real
 * topics grounded in the document's own headings — never invented content.
 */
export function segmentTopicsByHeading(chunks: ChunkDraft[]): TopicDraft[] {
  const groups = new Map<string, { pages: Set<number>; text: string[] }>();

  for (const chunk of chunks) {
    const key = chunk.sectionTitle ?? 'Overview';
    const group = groups.get(key) ?? { pages: new Set<number>(), text: [] };
    group.pages.add(chunk.page);
    if (group.text.length < 3) group.text.push(chunk.content);
    groups.set(key, group);
  }

  let entries = [...groups.entries()];

  // No headings at all: fall back to fixed page bands so the student still gets
  // a navigable structure.
  if (entries.length <= 1 && chunks.length > 4) {
    const pages = [...new Set(chunks.map((c) => c.page))].sort((a, b) => a - b);
    const bandCount = Math.min(6, Math.max(2, Math.round(pages.length / 5)));
    const perBand = Math.ceil(pages.length / bandCount);

    entries = Array.from({ length: bandCount }, (_, i) => {
      const band = pages.slice(i * perBand, (i + 1) * perBand);
      const text = chunks
        .filter((c) => band.includes(c.page))
        .slice(0, 3)
        .map((c) => c.content);
      return [
        `Pages ${band[0]}–${band.at(-1)}`,
        { pages: new Set(band), text },
      ] as [string, { pages: Set<number>; text: string[] }];
    }).filter(([, g]) => g.pages.size > 0);
  }

  const drafts = entries.slice(0, MAX_TOPICS).map(([name, group]) => ({
    name,
    slug: slugify(name),
    summary: buildExtractiveSummary(group.text),
    sourcePages: [...group.pages].sort((a, b) => a - b),
    prerequisiteSlugs: [],
  }));

  return dedupeSlugs(drafts);
}

/**
 * An extractive summary: the opening sentences of the topic's own text.
 * Extractive, not generative — the fallback must never invent content.
 */
function buildExtractiveSummary(texts: string[]): string {
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return 'Content from this section of the material.';

  const sentences = joined.match(/[^.!?]+[.!?]+/g) ?? [joined];
  const summary = sentences.slice(0, 2).join(' ').trim();
  return summary.length > 400 ? `${summary.slice(0, 397)}...` : summary;
}

/** Compact outline given to the model: headings plus a short opening excerpt. */
function buildOutline(chunks: ChunkDraft[]): string {
  const lines: string[] = [];
  let lastTitle: string | null = null;

  for (const chunk of chunks) {
    if (chunk.sectionTitle !== lastTitle) {
      lines.push(`\n## ${chunk.sectionTitle ?? 'Untitled'} (p.${chunk.page})`);
      lastTitle = chunk.sectionTitle;
    }
    lines.push(`- p.${chunk.page}: ${chunk.content.slice(0, 160).replace(/\s+/g, ' ')}`);
  }

  return lines.join('\n').slice(0, 12_000);
}

const SYSTEM = `You organise study material into topics for a high-school student.

Rules:
- Use ONLY the outline provided. Never invent a topic the material does not cover.
- Order topics the way the material teaches them.
- sourcePages must be page numbers that appear in the outline.
- prerequisiteSlugs may only reference other topics you are returning, using a
  lowercase_underscore form of their name. Use [] when unsure.
- Between 3 and 10 topics for a typical module. Prefer fewer, broader topics
  over many tiny ones.
- Summaries: one or two plain sentences a 16-year-old would understand.`;

export async function extractTopics(
  chunks: ChunkDraft[],
  llm: LlmClient,
): Promise<{ topics: TopicDraft[]; usedFallback: boolean }> {
  if (chunks.length === 0) return { topics: [], usedFallback: true };

  const validPages = new Set(chunks.map((c) => c.page));

  const { value, usedFallback } = await llm.generateJson({
    schema: llmTopicSchema,
    system: SYSTEM,
    prompt: `Outline of the material:\n${buildOutline(chunks)}`,
    retries: 1,
    fallback: () => ({ topics: segmentTopicsByHeading(chunks).map(stripSlug) }),
  });

  const drafts = value.topics.map((topic) => ({
    name: topic.name,
    slug: slugify(topic.name),
    summary: topic.summary,
    // Drop hallucinated page numbers rather than trusting them.
    sourcePages: topic.sourcePages.filter((p) => validPages.has(p)),
    prerequisiteSlugs: topic.prerequisiteSlugs ?? [],
  }));

  // A topic whose every page was invented is not grounded — discard it.
  const grounded = drafts.filter((t) => t.sourcePages.length > 0);

  if (grounded.length === 0) {
    return { topics: segmentTopicsByHeading(chunks), usedFallback: true };
  }

  return { topics: dedupeSlugs(grounded), usedFallback };
}

/** The LLM schema has no `slug`; the fallback produces one. Align the shapes. */
function stripSlug(topic: TopicDraft) {
  return {
    name: topic.name,
    summary: topic.summary,
    sourcePages: topic.sourcePages,
    prerequisiteSlugs: topic.prerequisiteSlugs,
  };
}
