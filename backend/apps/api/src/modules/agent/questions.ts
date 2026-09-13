import { z } from 'zod';
import type { Difficulty, OptionLabel } from '@educlm/contracts';
import type { LlmBudget, LlmClient } from '../../lib/llm.js';
import { collectTerms } from '../ingestion/terms.js';
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
  /**
   * True when this question came from the deterministic cloze builder rather
   * than the model — either because no key is configured or because the call
   * failed. One call can return a mix of both, so provenance belongs on the
   * question, not on the batch, and it is what `generatedBy` gets stored as.
   */
  usedFallback: boolean;
}

const generatedQuestionSchema = z.object({
  questions: z.array(
    z.object({
      /** Which of the listed topics the question is about (1-based). */
      topicNumber: z.number().int(),
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
      // Required: Groq's strict JSON mode rejects defaulted (optional) properties.
      difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
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

  return `You write multiple-choice practice questions from a student's own study
material. Good questions check understanding, not memory of wording.

HARD REQUIREMENTS — a question breaking any of these is discarded:
- Exactly 4 options, labelled A, B, C, D.
- Exactly ONE option is correct. That option MUST have "misconceptionTag": null.
- Every other option MUST carry a misconceptionTag from this list, and nothing else:
${list}
- Each wrong option is the answer a student would pick if they held that
  specific misconception. It must be plausible, similar in length and style to
  the correct option, and clearly wrong according to the material.
- "sourcePage" must be a page number from the passages provided.
- The question must be answerable from the passages alone. Never test outside
  knowledge.

WHAT TO ASK
- Mix the kinds of question: what a concept means, why something works the way
  it does, what happens in a given situation, and — when the material has code
  — what a snippet does or which snippet is correct.
- Cover different parts of the passages; do not ask two questions about the
  same sentence.
- Never ask about page numbers, slide titles, the author, or trivia such as
  exact wording.
- difficulty: "beginner" for recall of a key idea, "intermediate" for applying
  it, "advanced" for comparing ideas or spotting a subtle error. Mix levels.

WORDING
- Short stems in plain language, no trick wording, no "all of the above" or
  "none of the above".
- "explanation": 2-3 plain sentences on why the correct answer is right and
  what the misconception behind the most tempting wrong answer gets wrong.
  Refer to options by their content rather than by letter, and mention the
  page.`;
}

/**
 * Where each question's correct answer should go, balanced across A-D.
 *
 * Models favour one slot for the right answer, and a student who notices learns
 * the pattern instead of the material. Shuffling afterwards would fix that but
 * break any explanation that names a letter ("Option A is right because…"),
 * which models write even when told not to — so the position is assigned up
 * front and the model writes the explanation to match it.
 */
export function pickAnswerPositions(count: number, random: () => number = Math.random): OptionLabel[] {
  const positions: OptionLabel[] = [];
  while (positions.length < count) {
    const round = [...LABELS];
    for (let i = round.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [round[i], round[j]] = [round[j]!, round[i]!];
    }
    positions.push(...round);
  }
  return positions.slice(0, count);
}

/** One topic's share of a batched request. */
export interface TopicRequest {
  topicId: string;
  topicName: string;
  chunks: RetrievedChunk[];
  count: number;
}

export interface TopicQuestion extends GeneratedQuestion {
  topicId: string;
}

/**
 * Output sized to the ask: roughly 450 tokens a question plus room for the
 * model's reasoning. Reserving the whole budget for a single question made the
 * free-tier pacer treat every call as a large one — about one a minute on Groq.
 */
export function questionOutputTokens(count: number, budget: LlmBudget): number {
  return Math.min(budget.outputTokens, 600 + 450 * count);
}

/** Passage characters per topic: sized to the question count, split evenly across topics. */
export function passageCharsPerTopic(
  totalQuestions: number,
  topicCount: number,
  budget: LlmBudget,
): number {
  const total = Math.min(budget.inputChars, 2_500 + 2_000 * totalQuestions);
  return Math.floor(total / Math.max(1, topicCount));
}

/**
 * Questions for several topics in one model call.
 *
 * A diagnostic set spans the material, and asking topic by topic cost one call
 * each — five sequential calls for a five-question set. Here each topic's
 * passages are labelled, the model tags every question with its topic, and each
 * question is validated against that topic's own pages, so a question cannot
 * borrow a page from a neighbour. Shortfalls get one more round, then the
 * deterministic cloze builder.
 */
export async function generateQuestionsForTopics(params: {
  topics: TopicRequest[];
  vocabulary: VocabularyEntry[];
  llm: LlmClient;
  /** Bias distractors toward this tag, for adaptation-driven focused sets. */
  emphasiseTag?: string | undefined;
  logger?: { warn: (msg: string) => void } | undefined;
}): Promise<TopicQuestion[]> {
  const { vocabulary, llm, emphasiseTag, logger } = params;
  const topics = params.topics.filter((t) => t.chunks.length > 0 && t.count > 0);
  if (topics.length === 0 || vocabulary.length === 0) return [];

  const tags = new Set(vocabulary.map((v) => v.tag));
  const contextFor = (topic: TopicRequest): ValidationContext => ({
    validPages: new Set(topic.chunks.map((c) => c.page)),
    vocabulary: tags,
  });

  const accepted = new Map<string, GeneratedQuestion[]>(topics.map((t) => [t.topicId, []]));
  const missingFor = (topic: TopicRequest) => topic.count - accepted.get(topic.topicId)!.length;

  const emphasis = emphasiseTag
    ? `\n\nWherever it fits naturally, make one distractor use the tag "${emphasiseTag}" — the student is currently struggling with it.`
    : '';

  for (let round = 0; round < 2; round += 1) {
    const wanted = topics.filter((t) => missingFor(t) > 0);
    if (wanted.length === 0) break;

    const total = wanted.reduce((sum, t) => sum + missingFor(t), 0);
    const perTopic = passageCharsPerTopic(total, wanted.length, llm.budget);
    const positions = pickAnswerPositions(total)
      .map((label, index) => `question ${index + 1}: ${label}`)
      .join(', ');

    const blocks = wanted
      .map((topic, index) => {
        const n = missingFor(topic);
        const passages = topic.chunks
          .map((c) => `[p.${c.page}] ${c.content}`)
          .join('\n\n')
          .slice(0, perTopic);
        return `## Topic ${index + 1}: ${topic.topicName} — write ${n} question${n === 1 ? '' : 's'}\n${passages}`;
      })
      .join('\n\n');

    const { value, usedFallback } = await llm.generateJson({
      schema: generatedQuestionSchema,
      system: buildSystem(vocabulary),
      prompt: `Write ${total} multiple-choice question${total === 1 ? '' : 's'}: exactly as many for each topic as it lists, each with "topicNumber" set to that topic's number and "sourcePage" taken from that topic's passages.${emphasis}

Put the correct answer at this label, in order — ${positions}.

${blocks}`,
      retries: 1,
      maxOutputTokens: questionOutputTokens(total, llm.budget),
      fallback: () => ({
        questions: wanted.flatMap((topic, index) =>
          buildFallbackQuestions(topic.chunks, vocabulary, missingFor(topic), emphasiseTag).map(
            (question) => ({ ...question, topicNumber: index + 1 }),
          ),
        ),
      }),
    });

    for (const candidate of value.questions) {
      const topic = wanted[candidate.topicNumber - 1];
      if (!topic) {
        logger?.warn(`[questions] discarded a question: unknown topic ${candidate.topicNumber}`);
        continue;
      }
      if (missingFor(topic) <= 0) continue;

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
        // `generateJson` answers with the fallback on failure, and the shape is
        // identical either way — this flag is the only thing that distinguishes
        // them, so it has to be read here rather than inferred later.
        usedFallback,
      };

      const result = validateQuestion(question, contextFor(topic));
      if (result.ok) accepted.get(topic.topicId)!.push(question);
      else logger?.warn(`[questions] discarded a question: ${result.reason}`);
    }
  }

  // Top up deterministically rather than returning a short set.
  for (const topic of topics) {
    const missing = missingFor(topic);
    if (missing <= 0) continue;

    const filler = buildFallbackQuestions(topic.chunks, vocabulary, missing, emphasiseTag);
    for (const question of filler) {
      if (validateQuestion(question, contextFor(topic)).ok) {
        accepted.get(topic.topicId)!.push(question);
      }
    }
  }

  return topics.flatMap((topic) =>
    accepted
      .get(topic.topicId)!
      .slice(0, topic.count)
      .map((question) => ({ ...question, topicId: topic.topicId })),
  );
}

// ─── Deterministic fallback ──────────────────────────────────────────────────


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
        usedFallback: true,
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


function pickKeyTerm(sentence: string, terms: string[]): string | null {
  for (const term of terms) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(sentence)) return term;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
