import { z } from 'zod';
import type { Difficulty, OptionLabel } from '@educlm/contracts';
import type { LlmClient } from '../../lib/llm.js';
import type { VocabularyEntry } from '../ingestion/vocabulary.js';
import type { RetrievedChunk } from './retrieval.js';

/**
 * Multiple-choice question generation.
 *
 * Every distractor carries a misconception tag from the material's controlled
 * vocabulary. That is what makes the analytics engine work: it groups by exact
 * tag match, so a free-text tag would turn a recurring misconception into three
 * unrelated one-offs.
 *
 * Anything that fails validation is discarded and regenerated. Malformed
 * questions are worse than fewer questions.
 */

export const LABELS = ['A', 'B', 'C', 'D'] as const;

export interface GeneratedOption {
  label: OptionLabel;
  text: string;
  misconceptionTag: string | null;
}

export interface GeneratedQuestion {
  stem: string;
  options: GeneratedOption[];
  correctLabel: OptionLabel;
  explanation: string;
  sourcePage: number;
  difficulty: Difficulty;
}

const generatedQuestionSchema = z.object({
  questions: z.array(
    z.object({
      stem: z.string().min(5).max(500),
      options: z.array(
        z.object({
          label: z.enum(LABELS),
          text: z.string().min(1).max(300),
          misconceptionTag: z.string().nullable(),
        }),
      ),
      correctLabel: z.enum(LABELS),
      explanation: z.string().min(1).max(1200),
      sourcePage: z.number().int().positive(),
      difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    }),
  ),
});

// ─── Validation (pure) ───────────────────────────────────────────────────────

export interface ValidationContext {
  validPages: Set<number>;
  vocabulary: Set<string>;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate before persisting: exactly one option with `misconceptionTag: null`,
 * that option is `correctLabel`, `sourcePage` exists in the material, and all
 * tags are in the vocabulary.
 */
export function validateQuestion(
  question: GeneratedQuestion,
  context: ValidationContext,
): ValidationResult {
  if (question.options.length !== 4) {
    return { ok: false, reason: `expected 4 options, got ${question.options.length}` };
  }

  const labels = question.options.map((o) => o.label);
  if (new Set(labels).size !== 4) {
    return { ok: false, reason: 'duplicate option labels' };
  }
  if (!LABELS.every((label) => labels.includes(label))) {
    return { ok: false, reason: 'options must be labelled A, B, C and D' };
  }

  const untagged = question.options.filter((o) => o.misconceptionTag === null);
  if (untagged.length !== 1) {
    return {
      ok: false,
      reason: `exactly one option must have a null misconceptionTag, got ${untagged.length}`,
    };
  }

  if (untagged[0]!.label !== question.correctLabel) {
    return { ok: false, reason: 'the untagged option is not the correct one' };
  }

  if (!context.validPages.has(question.sourcePage)) {
    return { ok: false, reason: `sourcePage ${question.sourcePage} is not in this material` };
  }

  for (const option of question.options) {
    if (option.misconceptionTag === null) continue;
    if (!context.vocabulary.has(option.misconceptionTag)) {
      return {
        ok: false,
        reason: `misconception tag "${option.misconceptionTag}" is not in the material vocabulary`,
      };
    }
  }

  const texts = question.options.map((o) => o.text.trim().toLowerCase());
  if (new Set(texts).size !== texts.length) {
    return { ok: false, reason: 'duplicate option text' };
  }

  return { ok: true };
}

// ─── LLM path ────────────────────────────────────────────────────────────────

function buildSystem(vocabulary: VocabularyEntry[]): string {
  const list = vocabulary.map((v) => `- ${v.tag}: ${v.label} — ${v.description}`).join('\n');

  return `You write multiple-choice questions from a student's own study material.

HARD REQUIREMENTS — a question breaking any of these is discarded:
- Exactly 4 options, labelled A, B, C, D.
- Exactly ONE option is correct. That option MUST have "misconceptionTag": null.
- Every other option MUST carry a misconceptionTag from this list, and nothing else:
${list}
- Each wrong option should be the answer a student would pick if they held that
  specific misconception. Do not write obviously silly distractors.
- "sourcePage" must be a page number from the passages provided.
- The question must be answerable from the passages alone. Never test outside knowledge.
- "explanation" says why the correct answer is right, in plain language, and
  references the page.

Write questions a 16-year-old can read: short stems, no trick wording.`;
}

export async function generateQuestions(params: {
  topicName: string;
  chunks: RetrievedChunk[];
  count: number;
  vocabulary: VocabularyEntry[];
  llm: LlmClient;
  /** Bias distractors toward this tag, for adaptation-driven focused sets. */
  emphasiseTag?: string | undefined;
  logger?: { warn: (msg: string) => void } | undefined;
}): Promise<GeneratedQuestion[]> {
  const { topicName, chunks, count, vocabulary, llm, emphasiseTag, logger } = params;

  if (chunks.length === 0 || vocabulary.length === 0) return [];

  const context: ValidationContext = {
    validPages: new Set(chunks.map((c) => c.page)),
    vocabulary: new Set(vocabulary.map((v) => v.tag)),
  };

  const source = chunks
    .map((c) => `[p.${c.page}] ${c.content}`)
    .join('\n\n')
    .slice(0, 14_000);

  const emphasis = emphasiseTag
    ? `\n\nWherever it fits naturally, make one distractor use the tag "${emphasiseTag}" — the student is currently struggling with it.`
    : '';

  const accepted: GeneratedQuestion[] = [];
  const maxRounds = 2;

  for (let round = 0; round < maxRounds && accepted.length < count; round += 1) {
    const missing = count - accepted.length;

    const { value } = await llm.generateJson({
      schema: generatedQuestionSchema,
      system: buildSystem(vocabulary),
      prompt: `Topic: ${topicName}

Write ${missing} multiple-choice question${missing === 1 ? '' : 's'} from these passages.${emphasis}

Passages:
${source}`,
      retries: 1,
      maxOutputTokens: 3000,
      fallback: () => ({
        questions: buildFallbackQuestions(chunks, vocabulary, missing, emphasiseTag),
      }),
    });

    for (const candidate of value.questions) {
      if (accepted.length >= count) break;

      const question: GeneratedQuestion = {
        stem: candidate.stem,
        options: candidate.options.map((o) => ({
          label: o.label,
          text: o.text,
          misconceptionTag: o.misconceptionTag,
        })),
        correctLabel: candidate.correctLabel,
        explanation: candidate.explanation,
        sourcePage: candidate.sourcePage,
        difficulty: candidate.difficulty,
      };

      const result = validateQuestion(question, context);
      if (result.ok) accepted.push(question);
      else logger?.warn(`[questions] discarded a question: ${result.reason}`);
    }
  }

  // Top up deterministically rather than returning a short set.
  if (accepted.length < count) {
    const filler = buildFallbackQuestions(
      chunks,
      vocabulary,
      count - accepted.length,
      emphasiseTag,
    );
    for (const question of filler) {
      if (validateQuestion(question, context).ok) accepted.push(question);
    }
  }

  return accepted.slice(0, count);
}

// ─── Deterministic fallback ──────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'they', 'have', 'will',
  'would', 'there', 'their', 'what', 'when', 'which', 'been', 'were', 'these',
  'those', 'then', 'than', 'into', 'each', 'because', 'about', 'while', 'where',
]);

/**
 * Cloze ("fill the blank") questions built straight from the source sentences.
 *
 * Crude but honest: the stem, the correct answer, and the distractors are all
 * real terms from the material, and the tags come from the stored vocabulary,
 * so responses still flow through the analytics engine correctly.
 */
export function buildFallbackQuestions(
  chunks: RetrievedChunk[],
  vocabulary: VocabularyEntry[],
  count: number,
  emphasiseTag?: string | undefined,
): GeneratedQuestion[] {
  const terms = collectTerms(chunks);
  if (terms.length < 4) return [];

  const orderedTags = orderTags(vocabulary, emphasiseTag);
  const questions: GeneratedQuestion[] = [];

  for (const chunk of chunks) {
    if (questions.length >= count) break;

    const sentences = (chunk.content.match(/[^.!?\n]{40,220}[.!?]/g) ?? []).map((s) => s.trim());

    for (const sentence of sentences) {
      if (questions.length >= count) break;

      const answer = pickKeyTerm(sentence, terms);
      if (!answer) continue;

      const distractors = terms
        .filter((t) => t.toLowerCase() !== answer.toLowerCase())
        .slice(0, 3);
      if (distractors.length < 3) continue;

      const stem = `Complete the sentence from page ${chunk.page}: "${sentence.replace(
        new RegExp(`\\b${escapeRegExp(answer)}\\b`, 'i'),
        '_____',
      )}"`;

      // Correct answer rotates through the labels so it is not always "A".
      const correctIndex = questions.length % 4;
      const pool = [...distractors];
      const options: GeneratedOption[] = LABELS.map((label, index) => {
        if (index === correctIndex) {
          return { label, text: answer, misconceptionTag: null };
        }
        const tagIndex = index < correctIndex ? index : index - 1;
        return {
          label,
          text: pool.shift() ?? `${answer} (variant ${index})`,
          misconceptionTag: orderedTags[tagIndex % orderedTags.length]!,
        };
      });

      questions.push({
        stem,
        options,
        correctLabel: LABELS[correctIndex]!,
        explanation: `The material uses "${answer}" here — see page ${chunk.page}.`,
        sourcePage: chunk.page,
        difficulty: 'beginner',
      });
    }
  }

  return questions;
}

function orderTags(vocabulary: VocabularyEntry[], emphasiseTag?: string): string[] {
  const tags = vocabulary.map((v) => v.tag);
  if (!emphasiseTag || !tags.includes(emphasiseTag)) return tags;
  return [emphasiseTag, ...tags.filter((t) => t !== emphasiseTag)];
}

/** Distinctive multi-character words, most frequent first. */
function collectTerms(chunks: RetrievedChunk[]): string[] {
  const counts = new Map<string, number>();

  for (const chunk of chunks) {
    for (const word of chunk.content.match(/\b[A-Za-z][A-Za-z_]{3,20}\b/g) ?? []) {
      const key = word.toLowerCase();
      if (STOPWORDS.has(key)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([word]) => word)
    .slice(0, 40);
}

function pickKeyTerm(sentence: string, terms: string[]): string | null {
  for (const term of terms) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(sentence)) return term;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
