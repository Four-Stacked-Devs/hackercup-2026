import type { Citation } from '@educlm/contracts';
import type { LlmClient } from '../../lib/llm.js';
import { buildSnippet, needsCitationRetry, resolveCitations } from './citations.js';
import type { RetrievedChunk } from './retrieval.js';

/**
 * The grounded tutoring agent.
 *
 * Constraints encoded here, not merely hoped for:
 *  - answers come only from retrieved chunks, each claim marked [p.N]
 *  - gaps are admitted rather than filled from general knowledge
 *  - finished graded work is refused, and the refusal is logged
 *  - no mastery claims: "you're weak in X" belongs to the analytics engine,
 *    which has the data; the agent does not.
 */

export const BASE_SYSTEM = `You are EducLM, a patient tutor helping a high-school student
understand their own uploaded study material.

GROUNDING — non-negotiable:
- Answer ONLY from the numbered source passages provided below.
- Mark every substantive claim with the page it came from, like [p.12].
- If the passages do not cover the question, say so plainly in one sentence,
  then say what the material DOES cover nearby. Never fill the gap from general
  knowledge while implying it came from their document.

HOW TO TEACH:
- Explain in plain language. Short sentences. Define terms the first time.
- Give a concrete example when it helps.
- End with one short guiding question that checks understanding.
- If the student seems to hold a specific misunderstanding, name it gently and
  contrast it with what the material says.

NEVER:
- Never claim to know the student's overall ability, mastery, or weaknesses.
  You do not have that data. Do not say "you are weak at" or "you always".
- Never produce finished graded work. If asked to complete an assignment, do
  the thinking WITH them instead: outline the reasoning, ask what they have so
  far, and work through one step at a time.
- Never invent a page number.`;

const HOMEWORK_GUARD = `
The student's message looks like a request to complete graded work. Do not
produce a finished answer they could submit. Offer to walk through the reasoning
together, and ask what they have tried so far.`;

/** Heuristics for "do my assignment for me". Deliberately conservative. */
const HOMEWORK_PATTERNS: RegExp[] = [
  /\b(do|answer|complete|finish|solve)\b[^.?!]{0,40}\b(my|this|the)\b[^.?!]{0,20}\b(assignment|homework|worksheet|quiz|exam|test|activity)\b/i,
  /\bwrite\b[^.?!]{0,30}\b(my|the)\b[^.?!]{0,20}\b(essay|report|paper|reflection)\b/i,
  /\bgive me the answers?\b/i,
  /\bwhat(?:'s| is) the answer to (?:number|item|question)\s*\d+/i,
];

export function looksLikeHomeworkRequest(message: string): boolean {
  return HOMEWORK_PATTERNS.some((pattern) => pattern.test(message));
}

export function buildContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '(No passages matched this question.)';

  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] p.${chunk.page}${chunk.sectionTitle ? ` — ${chunk.sectionTitle}` : ''}\n${chunk.content}`,
    )
    .join('\n\n');
}

export function buildSystemPrompt(chunks: RetrievedChunk[], isHomework: boolean): string {
  return [
    BASE_SYSTEM,
    isHomework ? HOMEWORK_GUARD : '',
    '\nSOURCE PASSAGES:\n',
    buildContext(chunks),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Deterministic answer used when no model is configured, or when the model
 * fails. It quotes the retrieved passages and cites their pages — grounded and
 * honest, if plainly worded.
 */
export function deterministicAnswer(
  question: string,
  chunks: RetrievedChunk[],
  isHomework: boolean,
): string {
  if (isHomework) {
    return [
      "I won't write out an answer you'd hand in — that wouldn't help you in the exam.",
      '',
      "Let's work through it instead. Tell me what you have so far, or which part is unclear, and I'll take it one step at a time using your material.",
    ].join('\n');
  }

  if (chunks.length === 0) {
    return [
      "I couldn't find anything about that in this material.",
      '',
      'Try rephrasing the question, or ask about one of the topics listed for this document.',
    ].join('\n');
  }

  const top = chunks.slice(0, 3);
  const lines = [
    `Here is what your material says about that:`,
    '',
    ...top.map((chunk) => `- ${buildSnippet(chunk.content, 220)} [p.${chunk.page}]`),
    '',
    `Which part would you like me to break down further?`,
  ];

  return lines.join('\n');
}

export interface AnswerResult {
  text: string;
  citations: Citation[];
  refusedHomework: boolean;
  usedFallback: boolean;
}

/** Non-streaming answer. */
export async function answerQuestion(params: {
  question: string;
  chunks: RetrievedChunk[];
  llm: LlmClient;
}): Promise<AnswerResult> {
  const { question, chunks, llm } = params;
  const isHomework = looksLikeHomeworkRequest(question);
  const fallback = () => deterministicAnswer(question, chunks, isHomework);

  const first = await llm.generateText({
    system: buildSystemPrompt(chunks, isHomework),
    prompt: question,
    temperature: 0.3,
    fallback,
  });

  let text = first.text;
  let citations = resolveCitations(text, chunks);

  // One stricter retry when a substantive answer came back uncited.
  if (!first.usedFallback && needsCitationRetry(text, citations)) {
    const retry = await llm.generateText({
      system: `${buildSystemPrompt(chunks, isHomework)}

Your previous answer cited no pages. Rewrite it so that EVERY substantive claim
ends with the page marker it came from, like [p.12]. Use only the passages above.`,
      prompt: question,
      temperature: 0.1,
      fallback,
    });

    const retryCitations = resolveCitations(retry.text, chunks);
    if (retryCitations.length > 0) {
      text = retry.text;
      citations = retryCitations;
    }
  }

  return {
    text,
    citations,
    refusedHomework: isHomework,
    usedFallback: first.usedFallback,
  };
}

/**
 * Streaming answer. Citations are resolved from the completed text and emitted
 * by the caller BEFORE `done`, so source chips appear as the answer settles.
 */
export async function* streamAnswer(params: {
  question: string;
  chunks: RetrievedChunk[];
  llm: LlmClient;
}): AsyncGenerator<string, { text: string; citations: Citation[]; refusedHomework: boolean }> {
  const { question, chunks, llm } = params;
  const isHomework = looksLikeHomeworkRequest(question);

  let text = '';

  for await (const delta of llm.streamText({
    system: buildSystemPrompt(chunks, isHomework),
    prompt: question,
    temperature: 0.3,
    fallback: () => deterministicAnswer(question, chunks, isHomework),
  })) {
    text += delta;
    yield delta;
  }

  return {
    text,
    citations: resolveCitations(text, chunks),
    refusedHomework: isHomework,
  };
}
