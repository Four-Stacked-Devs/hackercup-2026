import { z } from 'zod';
import type { LlmClient } from '../../lib/llm.js';
import type { TopicDraft } from './topics.js';

/**
 * The controlled misconception vocabulary, generated once per material.
 *
 * The analytics engine groups by EXACT tag match, so free-text tags invented
 * per question would silently break detection: three spellings of the same
 * misconception look like three unrelated one-off errors and never reach the
 * threshold. Generating the vocabulary up front, and validating every question
 * against it, is what keeps detection meaningful.
 */

export interface VocabularyEntry {
  tag: string;
  label: string;
  description: string;
}

const vocabularySchema = z.object({
  tags: z
    .array(
      z.object({
        tag: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/, 'lowercase_with_underscores')
          .max(60),
        label: z.string().min(1).max(120),
        description: z.string().min(1).max(400),
      }),
    )
    .min(3)
    .max(20),
});

/**
 * Subject-agnostic fallback. Deliberately about *reasoning* errors rather than
 * invented subject facts, so it stays truthful for any material.
 */
export const GENERIC_VOCABULARY: VocabularyEntry[] = [
  {
    tag: 'confusing_similar_terms',
    label: 'Confusing two similar terms',
    description:
      'Two terms in this material look or sound alike, and the wrong one is being applied.',
  },
  {
    tag: 'overgeneralising_a_rule',
    label: 'Applying a rule too broadly',
    description: 'A rule that holds in one case is being applied where it does not hold.',
  },
  {
    tag: 'wrong_order_of_steps',
    label: 'Carrying out steps in the wrong order',
    description: 'The right steps are being used, but in an order that changes the result.',
  },
  {
    tag: 'ignoring_edge_cases',
    label: 'Missing the exception',
    description: 'The usual case is handled correctly but a stated exception is overlooked.',
  },
  {
    tag: 'misreading_the_question',
    label: 'Answering a different question',
    description: 'The answer is sound but addresses something the question did not ask.',
  },
];

const SYSTEM = `You name the misconceptions a student is likely to have about a specific
piece of study material.

Rules:
- Base every entry on what the material actually covers.
- tag: lowercase_with_underscores, stable and specific (e.g. assignment_vs_comparison).
- label: how you would say it to the student, in plain words.
- description: one sentence explaining the confusion.
- 5 to 10 entries. Prefer specific, checkable confusions over vague ones like
  "does not understand the topic".`;

export async function buildVocabulary(
  materialTitle: string,
  topics: TopicDraft[],
  llm: LlmClient,
): Promise<{ entries: VocabularyEntry[]; usedFallback: boolean }> {
  const outline = topics
    .map((t) => `- ${t.name}: ${t.summary}`)
    .join('\n')
    .slice(0, 6000);

  const { value, usedFallback } = await llm.generateJson({
    schema: vocabularySchema,
    system: SYSTEM,
    prompt: `Material: ${materialTitle}\n\nTopics covered:\n${outline}`,
    retries: 1,
    fallback: () => ({ tags: GENERIC_VOCABULARY }),
  });

  // Deduplicate by tag — the uniqueness constraint is per material.
  const seen = new Set<string>();
  const entries = value.tags.filter((entry) => {
    if (seen.has(entry.tag)) return false;
    seen.add(entry.tag);
    return true;
  });

  return {
    entries: entries.length > 0 ? entries : GENERIC_VOCABULARY,
    usedFallback,
  };
}
