import { z } from 'zod';
import type { LlmClient } from '../../lib/llm.js';
import type { ChunkDraft } from './chunk.js';
import { GENERIC_VOCABULARY, normaliseVocabulary, type VocabularyEntry } from './vocabulary.js';

/**
 * The course map — one LLM call over the material's page-by-page text that
 * returns both the topics and the misconception vocabulary.
 *
 * They used to be two calls, back to back, on the path the student waits on.
 * The second only ever read the first one's output, so asking for both at once
 * costs one round trip instead of two with nothing lost.
 *
 * If the model is unavailable or returns unusable JSON twice, topics fall back
 * to heading-based segmentation and the vocabulary to the generic list.
 * Ingestion never hard-fails on an LLM hiccup.
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
        // Required, not defaulted: Groq's strict JSON mode rejects any schema
        // whose properties are not all required. The prompt asks for [] instead.
        prerequisiteSlugs: z.array(z.string()),
      }),
    )
    .min(MIN_TOPICS)
    .max(MAX_TOPICS),
  // Deliberately loose: one malformed tag must not throw away the topics with
  // it. normaliseVocabulary repairs or drops each entry afterwards.
  misconceptions: z.array(
    z.object({ tag: z.string(), label: z.string(), description: z.string() }),
  ),
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

/**
 * Page-by-page text given to the model, as much of each page as the budget allows.
 *
 * Headings plus a 160-character opening used to be all it saw, which is nothing
 * for a slide deck: most slides have no detectable heading, so the model was
 * naming topics from fragments. Splitting the budget evenly across pages keeps
 * a long document's later chapters from being cut off entirely.
 */
export function buildOutline(chunks: ChunkDraft[], budgetChars: number): string {
  const byPage = new Map<number, { title: string | null; text: string[] }>();

  for (const chunk of chunks) {
    const entry = byPage.get(chunk.page) ?? { title: chunk.sectionTitle, text: [] };
    entry.text.push(chunk.content);
    byPage.set(chunk.page, entry);
  }

  const perPage = Math.max(200, Math.floor(budgetChars / Math.max(1, byPage.size)));

  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, { title, text }]) => {
      const body = text.join(' ').replace(/\s+/g, ' ').trim();
      const clipped = body.length > perPage ? `${body.slice(0, perPage)}…` : body;
      return `[p.${page}]${title ? ` (${title})` : ''}\n${clipped}`;
    })
    .join('\n\n')
    .slice(0, budgetChars);
}

const SYSTEM = `You design the topic structure of a study guide built from a student's own
course material (lecture slides, handouts, or textbook chapters).

Read the page-by-page text and group it into the topics a student would study.

Rules:
- Ground every topic in the pages given. Never invent a topic the material does
  not cover.
- Order topics the way the material teaches them.
- Skip pages with nothing to learn: cover or title slides, agendas, "thank you"
  or "questions?" slides, reference lists, and admin notes. Do not make topics
  from them.
- Name each topic after the concept it teaches (for example "Fetching data with
  useEffect"), never after its position ("Part 2", "Slide 5") or a bare generic
  word ("Introduction", "Overview", "Summary").
- sourcePages: list EVERY page the topic draws on, not just the first one.
  Every number must be a page shown to you.
- summary: 2-3 plain sentences saying what the topic is about and what the
  student will understand or be able to do after studying it. Name the key
  terms it introduces.
- prerequisiteSlugs: other topics in your list that must be understood first,
  written as the lowercase_underscore form of their exact name. Use [] when
  none.
- Aim for 3 to 10 topics. Prefer fewer, meaningful topics over many tiny ones;
  a short deck may only need 2 to 4.
- Keep the subject at the material's own level. Simplify the language, not the
  content.

Also list the misconceptions a student is likely to have about THIS material
(5 to 10 entries), used to tag wrong answers in practice questions:
- Base every entry on what the material actually covers.
- tag: lowercase_with_underscores, stable and specific (for example
  assignment_vs_comparison).
- label: how you would say it to the student, in plain words.
- description: one sentence explaining the confusion.
- Prefer specific, checkable confusions over vague ones like "does not
  understand the topic".`;

export interface CourseMap {
  topics: TopicDraft[];
  vocabulary: VocabularyEntry[];
  usedFallback: boolean;
}

export async function extractCourseMap(
  chunks: ChunkDraft[],
  llm: LlmClient,
  materialTitle?: string,
): Promise<CourseMap> {
  if (chunks.length === 0) {
    return { topics: [], vocabulary: GENERIC_VOCABULARY, usedFallback: true };
  }

  const validPages = new Set(chunks.map((c) => c.page));
  const heading = materialTitle ? `Material: ${materialTitle}\n\n` : '';

  const { value, usedFallback } = await llm.generateJson({
    schema: llmTopicSchema,
    system: SYSTEM,
    prompt: `${heading}Page-by-page text:\n\n${buildOutline(chunks, llm.budget.inputChars)}`,
    retries: 1,
    fallback: () => ({
      topics: segmentTopicsByHeading(chunks).map(stripSlug),
      misconceptions: GENERIC_VOCABULARY,
    }),
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
  const vocabulary = normaliseVocabulary(value.misconceptions);

  if (grounded.length === 0) {
    return { topics: segmentTopicsByHeading(chunks), vocabulary, usedFallback: true };
  }

  return { topics: dedupeSlugs(grounded), vocabulary, usedFallback };
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
