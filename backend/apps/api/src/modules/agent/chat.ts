import type { Citation } from '@educlm/contracts';
import type { ChatTurn, LlmClient } from '../../lib/llm.js';
import {
  buildSnippet,
  needsCitationRetry,
  normalizeCitationMarkers,
  resolveCitations,
} from './citations.js';
import type { RetrievedChunk } from './retrieval.js';

/**
 * The grounded tutoring agent.
 *
 * Constraints encoded here, not merely hoped for:
 *  - facts come only from retrieved chunks, each marked [p.N]
 *  - the tutor may teach with its own analogies, but labels them as its own
 *  - gaps are admitted rather than filled from general knowledge
 *  - finished graded work is refused, and the refusal is logged
 *  - no mastery claims: "you're weak in X" belongs to the analytics engine,
 *    which has the data; the agent does not.
 */

/** What the tutor knows about the material beyond the passages themselves. */
export interface MaterialContext {
  title: string | null;
  /** Topic list, so a gap answer can point at what the material does cover. */
  topics: { name: string; summary: string; sourcePages: number[] }[];
  /** Set when the thread is scoped to one topic. */
  topicName?: string | null;
}

const EMPTY_CONTEXT: MaterialContext = { title: null, topics: [] };

export const BASE_SYSTEM = `You are EDU, a friendly and patient tutor inside EducLM. The student is
studying their own uploaded course material. Your job is to help them actually
understand it, not just to repeat it.

HOW TO ANSWER
- Answer what they asked directly in the first sentence or two, then explain.
- The SOURCE PASSAGES below are your source of truth for facts about the
  subject. Mark every claim that comes from them with its page, like [p.12],
  right after the claim. Use exactly that form, one page per marker: [p.7]
  [p.9] — never a range like [p.7-9], and never 【1†p.7】 or footnotes.
- Teach, don't just quote. Rephrase in plain language, define each term the
  first time you use it, break processes into numbered steps, and walk through
  code line by line when there is code.
- You may add your own analogy or simple illustrative example to make an idea
  click. When you do, say so ("Here's an everyday analogy: ...") and give it no
  page marker. Never present an outside fact as if their material said it.
- If the passages do not cover the question, say so plainly in one sentence,
  then point to the closest thing the material does cover (see the topic
  list). A brief general explanation is allowed only when clearly labelled as
  not from their material.
- Follow-ups such as "explain that more simply" or "show another example"
  refer to the conversation so far: rework your previous answer in that
  direction instead of starting over.
- Match length to the question. A quick definition gets 2-4 sentences; "explain
  X" gets a structured answer with bullets or numbered steps. Use markdown:
  **bold** key terms, lists, fenced code blocks. No headings in short answers.
- End with one short question that checks understanding or suggests a next
  step, unless they only asked for a quick fact.

NEVER
- Never claim to know the student's overall ability, mastery, or weaknesses.
  You do not have that data. Do not say "you are weak at" or "you always".
- Never produce finished graded work. If asked to complete an assignment, do
  the thinking WITH them instead: outline the reasoning, ask what they have so
  far, and work through one step at a time.
- Never invent a page number. Only cite pages that appear in the passages.`;

const OVERVIEW_GUIDE = `
The student asked for an overview. The passages below are the material in page
order. Write a concise, scannable study summary:
1. One or two sentences on what it is about overall.
2. The main ideas, grouped by topic, as short bullets with page markers.
3. "Key terms": each term the material introduces, with a one-line definition
   from the material. Skip this if it introduces none.
4. One suggestion for where to start studying or what to practise first.`;

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
 * retrieval and no citations. "Summarise this" gets the whole material rather
 * than a similarity search for the word "summary". Everything else keeps the
 * grounded path.
 */
export type ChatIntent = 'greeting' | 'capability' | 'overview' | 'material';

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

/**
 * Asking about the material as a whole.
 *
 * Anchored like the capability patterns: "summarise how useEffect cleans up"
 * names a subject, and similarity search over that subject is the right tool,
 * so only a summary of "this", "the pdf", "everything" and the like lands here.
 */
const DOCUMENT = String.raw`(?:(?:this|the|my|that)\s)?(?:pdf|document|doc|file|material|module|lesson|lecture|slides?|deck|chapter|topic|reading|notes?|handout|session)`;
const OVERVIEW_TARGET = String.raw`(?:\s(?:of\s|for\s)?(?:${DOCUMENT}|this|it|everything|all\sof\sit|the\swhole\sthing))?`;
const POLITE = String.raw`(?:(?:please|pls|can\syou|could\syou|would\syou|now)\s)*`;
const END = String.raw`(?:\s(?:for\sme|please|pls|briefly|quickly))?[\s!.?]*$`;

const OVERVIEW_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^${POLITE}(?:summari[sz]e|recap|outline|overview)${OVERVIEW_TARGET}${END}`, 'i'),
  new RegExp(
    String.raw`^${POLITE}(?:give|show|write|make)\s(?:me\s)?(?:a\s|an\s)?(?:short\s|quick\s|brief\s)?(?:summary|overview|recap|outline|gist)${OVERVIEW_TARGET}${END}`,
    'i',
  ),
  new RegExp(String.raw`^(?:tl;?dr|gist|summary|overview)${OVERVIEW_TARGET}${END}`, 'i'),
  new RegExp(String.raw`^what(?:'s|\sis)\s${DOCUMENT}\s(?:about|covering)${END}`, 'i'),
  new RegExp(String.raw`^what\sdoes\s${DOCUMENT}\s(?:cover|teach|talk\sabout|say)${END}`, 'i'),
  new RegExp(
    String.raw`^what\sare\sthe\s(?:main|key|important|big)\s(?:points|ideas|takeaways|concepts|topics)${OVERVIEW_TARGET}${END}`,
    'i',
  ),
];

export function classifyIntent(message: string): ChatIntent {
  const trimmed = message.trim();
  if (GREETING_ONLY.test(trimmed)) return 'greeting';
  if (CAPABILITY_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'capability';
  if (OVERVIEW_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'overview';
  return 'material';
}

/**
 * Words that only make sense against an earlier turn: "explain THAT again",
 * "another example", "why?". Retrieval on such a message alone matches nothing
 * useful, so the previous question is searched alongside it.
 */
const FOLLOW_UP =
  /\b(?:that|this|it|those|these|again|more|another|else|simpler|simply|example|examples|elaborate|why|how\scome|what\sabout|and\sthen)\b/i;

export function retrievalQuery(message: string, history: ChatTurn[]): string {
  const lastQuestion = [...history].reverse().find((turn) => turn.role === 'user')?.content;
  if (!lastQuestion) return message;

  const words = message.trim().split(/\s+/).length;
  return words <= 14 && FOLLOW_UP.test(message) ? `${lastQuestion}\n${message}` : message;
}

/**
 * The offer list. Every line maps to something the API actually serves, so the
 * agent cannot promise a feature that does not exist.
 */
const CAPABILITIES = [
  'Summarise the whole material, or one topic, with the page each point came from.',
  'Explain any part of the material in plain language, with examples, and check understanding as we go.',
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
  intent: 'greeting' | 'capability',
  materialTitle: string | null,
): string {
  const about = materialTitle ? ` about ${materialTitle}` : '';

  if (intent === 'greeting') {
    return [
      `Hi! I'm EDU, your study partner${materialTitle ? ` for ${materialTitle}` : ''}.`,
      '',
      `Ask me anything${about} and I'll explain it in plain language, quoting the page it came from. I can also summarise it, build practice questions, or show you how each topic is going.`,
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
    'Ask me a question about the material to get going, or say "summarise this" for an overview.',
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

/** Numbered passages, stopping at the budget so a small-context provider is never overfilled. */
export function buildContext(chunks: RetrievedChunk[], budgetChars = Infinity): string {
  if (chunks.length === 0) return '(No passages matched this question.)';

  const blocks: string[] = [];
  let used = 0;

  for (const [index, chunk] of chunks.entries()) {
    const block = `[${index + 1}] p.${chunk.page}${chunk.sectionTitle ? ` — ${chunk.sectionTitle}` : ''}\n${chunk.content}`;
    if (blocks.length > 0 && used + block.length > budgetChars) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join('\n\n');
}

function describeMaterial(context: MaterialContext): string {
  const lines: string[] = [];
  if (context.title) lines.push(`MATERIAL: ${context.title}`);
  if (context.topicName) lines.push(`CURRENT TOPIC: ${context.topicName}`);

  if (context.topics.length > 0) {
    lines.push(
      'TOPICS IN THIS MATERIAL:',
      ...context.topics.map((topic) => `- ${topic.name} (p.${topic.sourcePages.join(', ')})`),
    );
  }

  return lines.join('\n');
}

export function buildSystemPrompt(
  chunks: RetrievedChunk[],
  isHomework: boolean,
  options: { intent?: ChatIntent; context?: MaterialContext; budgetChars?: number } = {},
): string {
  const context = options.context ?? EMPTY_CONTEXT;

  return [
    BASE_SYSTEM,
    options.intent === 'overview' ? OVERVIEW_GUIDE : '',
    isHomework ? HOMEWORK_GUARD : '',
    `\n${describeMaterial(context)}`,
    '\nSOURCE PASSAGES:\n',
    buildContext(chunks, options.budgetChars),
  ]
    .filter((part) => part.trim())
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
  intent: ChatIntent = 'material',
  context: MaterialContext = EMPTY_CONTEXT,
): string {
  if (isHomework) {
    return [
      "I won't write out an answer you'd hand in — that wouldn't help you in the exam.",
      '',
      "Let's work through it instead. Tell me what you have so far, or which part is unclear, and I'll take it one step at a time using your material.",
    ].join('\n');
  }

  // The topic list is already a summary the pipeline wrote; it beats three
  // arbitrary opening sentences as an overview.
  if (intent === 'overview' && context.topics.length > 0) {
    return [
      `Here is what ${context.title ?? 'your material'} covers:`,
      '',
      ...context.topics.map(
        (topic) => `- **${topic.name}**: ${topic.summary} [p.${topic.sourcePages[0]}]`,
      ),
      '',
      'Which of these would you like to go through first?',
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

interface AnswerParams {
  question: string;
  chunks: RetrievedChunk[];
  llm: LlmClient;
  intent?: ChatIntent;
  /** Earlier turns of this conversation, oldest first. */
  history?: ChatTurn[];
  context?: MaterialContext;
}

/** Non-streaming answer. */
export async function answerQuestion(params: AnswerParams): Promise<AnswerResult> {
  const { question, chunks, llm } = params;
  const intent = params.intent ?? classifyIntent(question);
  const context = params.context ?? EMPTY_CONTEXT;
  const history = params.history ?? [];

  // Conversation, not coursework: no retrieval to lean on and nothing to cite,
  // so the grounded prompt and the citation retry are both skipped.
  if (intent === 'greeting' || intent === 'capability') {
    const conversational = await llm.generateText({
      system: conversationalSystem(context.title),
      prompt: question,
      history,
      temperature: 0.5,
      fallback: () => conversationalAnswer(intent, context.title),
    });

    return {
      text: conversational.text,
      citations: [],
      refusedHomework: false,
      usedFallback: conversational.usedFallback,
    };
  }

  const isHomework = looksLikeHomeworkRequest(question);
  const fallback = () => deterministicAnswer(question, chunks, isHomework, intent, context);
  const system = buildSystemPrompt(chunks, isHomework, {
    intent,
    context,
    budgetChars: llm.budget.inputChars,
  });

  const first = await llm.generateText({
    system,
    prompt: question,
    history,
    temperature: 0.3,
    fallback,
  });

  let text = normalizeCitationMarkers(first.text);
  let citations = resolveCitations(text, chunks);

  // One stricter retry when a substantive answer came back uncited.
  if (!first.usedFallback && needsCitationRetry(text, citations)) {
    const retry = await llm.generateText({
      system: `${system}

Your previous answer cited no pages. Rewrite it so that EVERY claim taken from
the material ends with the page marker it came from, like [p.12]. Use only the
passages above.`,
      prompt: question,
      history,
      temperature: 0.1,
      fallback,
    });

    const retryCitations = resolveCitations(retry.text, chunks);
    if (retryCitations.length > 0) {
      text = normalizeCitationMarkers(retry.text);
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
export async function* streamAnswer(
  params: AnswerParams,
): AsyncGenerator<string, { text: string; citations: Citation[]; refusedHomework: boolean }> {
  const { question, chunks, llm } = params;
  const intent = params.intent ?? classifyIntent(question);
  const context = params.context ?? EMPTY_CONTEXT;
  const history = params.history ?? [];

  // Mirrors answerQuestion: conversational turns stream too, so a greeting
  // arrives the same way an explanation does, just with no citations after it.
  if (intent === 'greeting' || intent === 'capability') {
    let conversational = '';

    for await (const delta of llm.streamText({
      system: conversationalSystem(context.title),
      prompt: question,
      history,
      temperature: 0.5,
      fallback: () => conversationalAnswer(intent, context.title),
    })) {
      conversational += delta;
      yield delta;
    }

    return { text: conversational, citations: [], refusedHomework: false };
  }

  const isHomework = looksLikeHomeworkRequest(question);

  let text = '';

  for await (const delta of llm.streamText({
    system: buildSystemPrompt(chunks, isHomework, {
      intent,
      context,
      budgetChars: llm.budget.inputChars,
    }),
    prompt: question,
    history,
    temperature: 0.3,
    fallback: () => deterministicAnswer(question, chunks, isHomework, intent, context),
  })) {
    text += delta;
    yield delta;
  }

  // The persisted message replaces the streamed one, so the student ends up
  // seeing clean [p.N] markers even if the stream showed 【1†p.N】.
  const normalized = normalizeCitationMarkers(text);

  return {
    text: normalized,
    citations: resolveCitations(normalized, chunks),
    refusedHomework: isHomework,
  };
}
