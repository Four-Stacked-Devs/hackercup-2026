import { z } from 'zod';
import type { LlmClient } from '../../lib/llm.js';

/**
 * What each plan step tells the student to do.
 *
 * The plan's order is the course order and its adaptation belongs to the pure
 * analytics engine; neither is the model's call. What the model adds is the
 * part a list of topic names cannot give: what to pay attention to while
 * reading, and what "done" looks like after practising.
 */

export interface GuidanceTopic {
  id: string;
  name: string;
  summary: string;
  sourcePages: number[];
}

export interface StepGuidance {
  readFocus: string;
  practiceGoal: string;
}

const guidanceSchema = z.object({
  topics: z.array(
    z.object({
      number: z.number().int().min(1),
      readFocus: z.string().min(1).max(400),
      practiceGoal: z.string().min(1).max(300),
    }),
  ),
});

const SYSTEM = `You write the step-by-step guidance in a student's study plan for their own
course material. Each topic has a READ step and a PRACTICE step.

For every topic, write:
- readFocus: 1-2 sentences telling the student what to pay attention to while
  reading — name the specific concepts, terms, or examples to understand, and
  point to a page when one matters (for example "Trace the example on p.6").
- practiceGoal: one sentence, starting with "You should be able to", describing
  the concrete skill the practice questions check.

Rules:
- Use only what the topic list says. Never invent content the topic does not
  cover.
- Speak to the student directly ("you"), plainly and encouragingly.
- Return one entry per topic, using the topic's number.`;

function fallbackGuidance(topic: GuidanceTopic): StepGuidance {
  return {
    readFocus: topic.summary,
    practiceGoal: `A short set of questions on ${topic.name}.`,
  };
}

export async function buildPlanGuidance(params: {
  materialTitle: string;
  topics: GuidanceTopic[];
  llm: LlmClient;
}): Promise<Map<string, StepGuidance>> {
  const { materialTitle, topics, llm } = params;
  const guidance = new Map(topics.map((topic) => [topic.id, fallbackGuidance(topic)]));
  if (topics.length === 0) return guidance;

  const list = topics
    .map(
      (topic, index) =>
        `${index + 1}. ${topic.name} (pages ${topic.sourcePages.join(', ')})\n   ${topic.summary}`,
    )
    .join('\n')
    .slice(0, llm.budget.inputChars);

  const { value, usedFallback } = await llm.generateJson({
    schema: guidanceSchema,
    system: SYSTEM,
    prompt: `Material: ${materialTitle}\n\nTopics, in study order:\n${list}`,
    retries: 1,
    fallback: () => ({ topics: [] }),
  });

  if (usedFallback) return guidance;

  for (const entry of value.topics) {
    const topic = topics[entry.number - 1];
    if (topic) {
      guidance.set(topic.id, { readFocus: entry.readFocus, practiceGoal: entry.practiceGoal });
    }
  }

  return guidance;
}

/**
 * Reading time from the lesson the student will actually read, at a
 * deliberately unhurried 150 words a minute plus time to look at the source.
 */
export function estimateReadMinutes(lessonText: string, pageCount: number): number {
  const words = lessonText.split(/\s+/).filter(Boolean).length;
  const minutes = words > 0 ? Math.round(words / 150) + 2 : pageCount * 3;
  return Math.min(30, Math.max(4, minutes));
}
