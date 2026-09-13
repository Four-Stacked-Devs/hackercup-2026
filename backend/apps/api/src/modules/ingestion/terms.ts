/**
 * The distinctive words a passage uses, most telling first.
 *
 * Shared by two deterministic fallbacks that must not disagree: the cloze
 * question builder picks the blank from here, and a topic with no model-written
 * key terms takes them from here too. Raw frequency alone ranked "should",
 * "often" and "right" as a topic's key terms, so ordinary words are dropped and
 * the words that look like terminology — long, or capitalised mid-sentence —
 * are ranked up.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'they', 'have', 'will',
  'would', 'there', 'their', 'what', 'when', 'which', 'been', 'were', 'these',
  'those', 'then', 'than', 'into', 'each', 'because', 'about', 'while', 'where',
  'should', 'could', 'must', 'might', 'shall', 'also', 'often', 'other', 'others',
  'some', 'more', 'most', 'many', 'much', 'such', 'very', 'only', 'just', 'like',
  'make', 'made', 'makes', 'used', 'using', 'uses', 'being', 'does', 'done',
  'doing', 'your', 'yours', 'them', 'those', 'here', 'right', 'wrong', 'good',
  'well', 'even', 'ever', 'every', 'same', 'different', 'example', 'examples',
  'thing', 'things', 'something', 'people', 'person', 'someone', 'always',
  'never', 'still', 'over', 'under', 'after', 'before', 'between', 'through',
  'without', 'within', 'another', 'however', 'therefore', 'thus', 'since',
  'first', 'second', 'third', 'next', 'last', 'both', 'either', 'neither',
  'whether', 'across', 'around', 'upon', 'onto', 'mean', 'means', 'meant',
  'called', 'known', 'including', 'include', 'includes', 'based', 'point',
  'points', 'part', 'parts', 'case', 'cases', 'type', 'types', 'kind', 'kinds',
  'way', 'ways', 'want', 'need', 'needs', 'take', 'takes', 'give', 'gives',
  'show', 'shows', 'page', 'slide', 'module', 'lesson', 'chapter', 'section',
]);

const WORD = /\b[A-Za-z][A-Za-z_-]{3,24}\b/g;

/** "computers" and "computer" are one term. */
export function stem(word: string): string {
  const lower = word.toLowerCase();
  return lower.length > 4 && lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower;
}

/** A heading or title line: most of its words are capitalised. */
function isTitleCase(line: string): boolean {
  const words = line.match(/[A-Za-z]{3,}/g) ?? [];
  if (words.length < 2) return true;
  return words.filter((word) => /^[A-Z]/.test(word)).length / words.length > 0.5;
}

export function collectTerms(passages: { content: string }[], limit = 40): string[] {
  const scores = new Map<string, number>();
  const spelling = new Map<string, string>();

  for (const passage of passages) {
    for (const line of passage.content.split('\n')) {
      // In a heading every word is capitalised, so capitals there say nothing.
      const heading = isTitleCase(line);

      for (const match of line.matchAll(WORD)) {
        const word = match[0];
        if (STOPWORDS.has(word.toLowerCase())) continue;
        const key = stem(word);

        // Capitalised where a sentence does not start: a name for something.
        const before = line.slice(Math.max(0, match.index - 2), match.index);
        const capitalisedMidSentence =
          !heading && /^[A-Z]/.test(word) && !/[.!?]\s*$|^\s*$/.test(before);
        const weight = (word.length >= 8 ? 2 : 1) * (capitalisedMidSentence ? 1.5 : 1);

        scores.set(key, (scores.get(key) ?? 0) + weight);
        if (!spelling.has(key) || capitalisedMidSentence) spelling.set(key, word);
      }
    }
  }

  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => spelling.get(key) ?? key)
    .slice(0, limit);
}
