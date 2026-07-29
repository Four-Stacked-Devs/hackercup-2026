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

/**
 * What the student's message is actually for.
 *
 * Not every message is a question about the document. "hi" answered by the
 * grounded prompt comes back as "the passages do not cover that", which reads
 * as broken. Greetings and "what can you do" get a conversational reply with no
 * retrieval and no citations; everything else keeps the grounded path.
 */
export type ChatIntent = 'greeting' | 'capability' | 'material';

/**
 * The whole message is a greeting or an acknowledgement. Anchored on purpose:
 * "hi, what is a closure?" carries a real question and must stay `material`.
 */
const GREETING_ONLY =
  /^(?:hi|hey|hello|yo|hiya|sup|good\s(?:morning|afternoon|evening)|thanks?|thank\syou|ty|cheers|ok(?:ay)?|cool|nice|great|bye|goodbye|see\sya)[\s!.,?]*$/i;

/**
 * Asking about the tool rather than the subject.
 *
 * Every pattern is anchored to the whole message, because the same opening
 * introduces real questions: "what can you do with arrays?" and "can you help
 * me with recursion" are about the material and must not land here.
 */
const CAPABILITY_TAIL = String.raw`(?:\sexactly|\shere|\sfor\sme|\swith\sthis|\sin\sthis\sapp)?[\s!.?]*$`;

const CAPABILITY_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^what\scan\syou\s(?:do|help\swith)${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^what\s(?:do|can)\syou\soffer${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^what\sare\syour\s(?:features|capabilities)${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^what\sdo\syou\sdo${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^who\sare\syou${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^what\sare\syou${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^how\s(?:do|can)\syou\s(?:work|help)(?:\sme)?${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^how\sdo\si\suse\s(?:this|you|it)${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^what\scan\si\sask(?:\syou)?(?:\sabout)?${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^(?:help|help\sme)${CAPABILITY_TAIL}`, 'i'),
  new RegExp(String.raw`^can\syou\shelp(?:\sme)?${CAPABILITY_TAIL}`, 'i'),
];

export function classifyIntent(message: string): ChatIntent {
  const trimmed = message.trim();
  if (GREETING_ONLY.test(trimmed)) return 'greeting';
  if (CAPABILITY_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'capability';
  return 'material';
}

/**
 * The offer list. Every line maps to something the API actually serves, so the
 * agent cannot promise a feature that does not exist.
 */
const CAPABILITIES = [
  'Explain any part of the material in plain language, marking the page each point came from.',
  'Work through a hard idea one step at a time, and check understanding as we go.',
  'Build practice questions from the material and mark them with feedback.',
  'Point to the progress screen: how each topic is going, accuracy over time, and the specific misunderstandings the answers reveal.',
  'Keep a study plan that adapts as practice happens.',
];

function conversationalSystem(materialTitle: string | null): string {
  return `You are EducLM ("EDU"), a warm, patient tutor inside a study app.

The student is making conversation rather than asking about their material —
a greeting, a thank-you, or a question about what you can do. Reply in two or
three short sentences, in plain language, and sound pleased to help.
${materialTitle ? `\nThe material they have open is "${materialTitle}".` : ''}

WHAT YOU CAN ACTUALLY DO — offer only from this list, never invent a feature:
${CAPABILITIES.map((line) => `- ${line}`).join('\n')}

NEVER:
- Never cite a page or write a [p.N] marker. There is nothing to cite here.
- Never claim to know the student's ability, mastery or weaknesses. You do not
  have that data.
- Never pretend to have read something you were not given.

Finish by inviting them to ask about the material, or to try one of the things
above.`;
}

/** Deterministic conversational reply, used when no model is configured. */
export function conversationalAnswer(
  intent: Exclude<ChatIntent, 'material'>,
  materialTitle: string | null,
): string {
  const about = materialTitle ? ` about ${materialTitle}` : '';

  if (intent === 'greeting') {
    return [
      `Hi! I'm EDU, your study partner${materialTitle ? ` for ${materialTitle}` : ''}.`,
      '',
      `Ask me anything${about} and I'll explain it in plain language, quoting the page it came from. I can also build practice questions, or show you how each topic is going.`,
      '',
      'What would you like to start with?',
    ].join('\n');
  }

  return [
    materialTitle
      ? `Here is what I can help you with on ${materialTitle}:`
      : 'Here is what I can help you with:',
    '',
    ...CAPABILITIES.map((line) => `- ${line}`),
    '',
    'Ask me a question about the material to get going, or say "quiz me" and I will build practice from it.',
  ].join('\n');
}

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
      "I couldn't find anything about that in this material, so I won't guess at it.",
      '',
      'Try rephrasing it, or ask about one of the topics listed for this document. I can also build practice questions from what it does cover, or show you how each topic is going.',
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
  intent?: ChatIntent;
  materialTitle?: string | null;
}): Promise<AnswerResult> {
  const { question, chunks, llm } = params;
  const intent = params.intent ?? classifyIntent(question);
  const materialTitle = params.materialTitle ?? null;

  // Conversation, not coursework: no retrieval to lean on and nothing to cite,
  // so the grounded prompt and the citation retry are both skipped.
  if (intent !== 'material') {
    const conversational = await llm.generateText({
      system: conversationalSystem(materialTitle),
      prompt: question,
      temperature: 0.5,
      fallback: () => conversationalAnswer(intent, materialTitle),
    });

    return {
      text: conversational.text,
      citations: [],
      refusedHomework: false,
      usedFallback: conversational.usedFallback,
    };
  }

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
  intent?: ChatIntent;
  materialTitle?: string | null;
}): AsyncGenerator<string, { text: string; citations: Citation[]; refusedHomework: boolean }> {
  const { question, chunks, llm } = params;
  const intent = params.intent ?? classifyIntent(question);
  const materialTitle = params.materialTitle ?? null;

  // Mirrors answerQuestion: conversational turns stream too, so a greeting
  // arrives the same way an explanation does, just with no citations after it.
  if (intent !== 'material') {
    let conversational = '';

    for await (const delta of llm.streamText({
      system: conversationalSystem(materialTitle),
      prompt: question,
      temperature: 0.5,
      fallback: () => conversationalAnswer(intent, materialTitle),
    })) {
      conversational += delta;
      yield delta;
    }

    return { text: conversational, citations: [], refusedHomework: false };
  }

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
