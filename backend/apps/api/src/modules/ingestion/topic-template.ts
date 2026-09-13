import { collectTerms, stem } from './terms.js';

/**
 * One shape for every topic, so every module of the learning plan reads alike.
 *
 * The model writes the outcomes and key terms, but only within limits: the plan
 * is a list of modules a student scans, and one topic answering with six
 * rambling sentences while the next answers with one word is what made the old
 * free-text guidance unreadable. Everything here is clamped to the template, and
 * a topic the model said nothing useful about still gets filled — from its own
 * summary and its own words — so no module renders half empty.
 */

export const MIN_OBJECTIVES = 2;
export const MAX_OBJECTIVES = 3;
export const MIN_TERMS = 3;
export const MAX_TERMS = 6;
const MAX_OBJECTIVE_CHARS = 120;
const MAX_TERM_CHARS = 40;

export interface TopicTemplate {
  objectives: string[];
  keyTerms: string[];
}

/** Trim, drop the trailing full stop, and cap the length. */
function tidy(value: string, max: number): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/^[-•*\d.\s]+/, '')
    .trim()
    .replace(/[.;,]+$/, '');

  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** Case-insensitive dedupe that keeps the first spelling seen. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    kept.push(value);
  }

  return kept;
}

/**
 * Outcomes for a topic the model said nothing usable about.
 *
 * Built from a template rather than lifted from the summary: a summary sentence
 * is a description ("Every society forms a set of rules…"), and dropped into
 * "Afterwards you should be able to …" it reads as nonsense. These always start
 * with a verb, always fit that sentence, and only claim what the topic's own
 * name and terms support.
 */
function fallbackObjectives(name: string): string[] {
  const topic = name.trim() || 'this topic';
  // Name-based on purpose. Weaving fallback key terms in ("Define Shalt and
  // Thou…") made a guess about the vocabulary into a claim about the outcome.
  return [
    `Explain the main ideas of ${topic}`,
    `Answer practice questions on ${topic} from memory`,
  ].map((outcome) => tidy(outcome, MAX_OBJECTIVE_CHARS));
}

/**
 * Fill a topic's template, using the model's answer where it is usable and the
 * topic's own text where it is not.
 */
export function buildTopicTemplate(params: {
  /** The topic's name, for templated outcomes when the model gave none. */
  name: string;
  objectives?: string[] | undefined;
  keyTerms?: string[] | undefined;
  /** The topic's passages, for terms when the model gave none. */
  passages?: { content: string }[] | undefined;
}): TopicTemplate {
  const keyTerms = dedupe(
    (params.keyTerms ?? []).map((term) => tidy(term, MAX_TERM_CHARS)),
  ).filter(Boolean);

  if (keyTerms.length < MIN_TERMS && params.passages?.length) {
    // The topic's own name is not a term it introduces.
    const nameWords = new Set(params.name.split(/\W+/).filter(Boolean).map(stem));
    for (const term of collectTerms(params.passages, MAX_TERMS * 3)) {
      if (keyTerms.length >= MIN_TERMS) break;
      if (nameWords.has(stem(term))) continue;
      if (!keyTerms.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
        keyTerms.push(term);
      }
    }
  }

  const objectives = dedupe(
    (params.objectives ?? []).map((objective) => tidy(objective, MAX_OBJECTIVE_CHARS)),
  ).filter(Boolean);

  if (objectives.length < MIN_OBJECTIVES) {
    for (const outcome of fallbackObjectives(params.name)) {
      if (objectives.length >= MIN_OBJECTIVES) break;
      if (!objectives.some((existing) => existing.toLowerCase() === outcome.toLowerCase())) {
        objectives.push(outcome);
      }
    }
  }

  return {
    objectives: objectives.slice(0, MAX_OBJECTIVES),
    keyTerms: keyTerms.slice(0, MAX_TERMS),
  };
}

/**
 * "1. Subjective Relativism" → "Subjective Relativism".
 *
 * Headings carry the list numbering of the slide they came from, so a plan of
 * modules numbered 1-12 read "Module 3 · 1. Subjective Relativism" beside
 * "Module 4 · a. Invisible Abuse". The module already has a number.
 */
export function tidyTopicName(name: string): string {
  const stripped = name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:\(?(?:\d{1,2}|[a-zA-Z]|[IVXivx]{1,4})[.)]\s+)+/, '');
  return stripped || name.trim();
}
