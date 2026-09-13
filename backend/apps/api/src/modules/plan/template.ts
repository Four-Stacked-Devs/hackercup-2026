/**
 * The learning plan's template.
 *
 * Every topic becomes a module with the same shape — read, then practise — and
 * every step's words are generated from the topic's own outcomes and key terms.
 * They used to be prose from a model call made while the student waited, which
 * cost a call per plan and read differently for every topic; the structured
 * fields on the topic (see ingestion/topic-template.ts) say the same thing in
 * the same shape, so the plan can be built without asking a model anything.
 */

export interface TemplateTopic {
  name: string;
  summary: string;
  sourcePages: number[];
  objectives: string[];
  keyTerms: string[];
}

/** "4", "4–7", "4, 9–11" — page numbers as a student would write them. */
export function pageRange(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const runs: string[] = [];
  let start = sorted[0]!;
  let previous = start;

  for (const page of sorted.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    runs.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = page;
    previous = page;
  }
  runs.push(start === previous ? `${start}` : `${start}–${previous}`);

  return runs.join(', ');
}

/** Lower-cases a leading capital so an outcome can follow "be able to". */
function asClause(objective: string): string {
  const trimmed = objective.trim().replace(/[.]+$/, '');
  if (!trimmed) return '';
  // Leave an acronym or an identifier alone: "SQL", "useQuery".
  if (/^[A-Z]{2,}|^[a-z]+[A-Z]/.test(trimmed)) return trimmed;
  return trimmed[0]!.toLowerCase() + trimmed.slice(1);
}

export function readStepTitle(topic: TemplateTopic): string {
  return `Read: ${topic.name}`;
}

export function practiceStepTitle(topic: TemplateTopic): string {
  return `Practise: ${topic.name}`;
}

/** "Study notes for pp. 4–7. Focus on: queryKey, queryFn, isPending." */
export function readStepDescription(topic: TemplateTopic): string {
  const pages = pageRange(topic.sourcePages);
  const where = pages ? `Study notes for ${topic.sourcePages.length === 1 ? 'p.' : 'pp.'} ${pages}.` : 'Study notes for this topic.';
  const focus = topic.keyTerms.length > 0 ? ` Focus on: ${topic.keyTerms.join(', ')}.` : '';

  return `${where}${focus}`;
}

/** "5 questions. Afterwards you should be able to explain how a queryKey works." */
export function practiceStepDescription(topic: TemplateTopic, questionCount: number): string {
  const objective = topic.objectives.map(asClause).find(Boolean);
  const goal = objective
    ? ` Afterwards you should be able to ${objective}.`
    : ` Checks what you took from ${topic.name}.`;

  return `${questionCount} questions.${goal}`;
}
