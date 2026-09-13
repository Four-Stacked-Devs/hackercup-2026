/**
 * The controlled misconception vocabulary, generated once per material as part
 * of the course map (see topics.ts).
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

const TAG_PATTERN = /^[a-z][a-z0-9_]*$/;
const MIN_ENTRIES = 3;
const MAX_ENTRIES = 20;

/** "Assignment vs. Comparison" → "assignment_vs_comparison". */
function toTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Turn the model's misconception list into a usable vocabulary.
 *
 * It arrives with the topics in one response, so a single badly formed tag
 * cannot be allowed to fail the whole course map: each entry is repaired where
 * possible and dropped where not, duplicates are collapsed (the uniqueness
 * constraint is per material), and too few survivors means the generic list.
 */
export function normaliseVocabulary(
  raw: { tag: string; label: string; description: string }[],
): VocabularyEntry[] {
  const seen = new Set<string>();
  const entries: VocabularyEntry[] = [];

  for (const entry of raw) {
    const tag = TAG_PATTERN.test(entry.tag) ? entry.tag.slice(0, 60) : toTag(entry.tag);
    const label = entry.label.trim().slice(0, 120);
    const description = entry.description.trim().slice(0, 400);

    if (!TAG_PATTERN.test(tag) || !label || !description || seen.has(tag)) continue;
    seen.add(tag);
    entries.push({ tag, label, description });
  }

  return entries.length >= MIN_ENTRIES ? entries.slice(0, MAX_ENTRIES) : GENERIC_VOCABULARY;
}
