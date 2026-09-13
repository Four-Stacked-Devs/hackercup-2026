/**
 * What to read while something is being prepared.
 *
 * A wait that says only "loading" invites a student to sit and watch it. Two
 * kinds of line earn their place: what the app is doing for them right now
 * (and what they can already get on with), and how to study the thing they
 * are waiting for. Nothing here is a boast or a joke — a student waiting on
 * their own coursework is not an audience for either.
 */

export type TipTopic = 'upload' | 'lesson' | 'practice' | 'plan' | 'chat';

const UPLOAD: string[] = [
  'Your material is readable the moment its topics appear — you do not have to wait for the study notes.',
  'EDU reads every page, groups it into topics, then writes study notes for each one in the background.',
  'Ask EDU "summarise this" once it opens, and you get the whole material in one page with the pages it came from.',
  'Every answer EDU gives is marked with the page it came from, so you can check it against your own PDF.',
];

const LESSON: string[] = [
  'The topic you open is written first — opening one moves it to the front of the queue.',
  'What you are reading now is your material’s own text. The study notes replace it here as soon as they are written.',
  'Reading with a question in mind beats reading start to finish. Try "why does this matter?" as you go.',
  'Tap a page marker to see the original page beside the notes.',
];

const PRACTICE: string[] = [
  'Answering from memory before checking is what makes practice stick — guess first, then read the explanation.',
  'Wrong answers here are the useful ones: each is tagged with the misunderstanding behind it.',
  'Short sets, often, beat one long session. Five questions a day outperforms thirty once a week.',
  'Read the explanation even when you get it right — it names what the question was really testing.',
];

const PLAN: string[] = [
  'Your plan reorders itself when practice shows a pattern, and tells you what changed and why.',
  'Skipping a step is a decision, not a gap — skipped steps leave your progress figures alone.',
  'Each module lists what you should be able to do afterwards. Use it as a self-check before moving on.',
];

const CHAT: string[] = [
  'Ask a follow-up in the same chat — "explain that more simply" keeps the thread it belongs to.',
  'EDU answers from your material only, and says so plainly when your material does not cover something.',
  'Ask for an example, a step-by-step, or a summary of one topic — whatever you would ask a tutor.',
];

const TIPS: Record<TipTopic, string[]> = {
  upload: UPLOAD,
  lesson: LESSON,
  practice: PRACTICE,
  plan: PLAN,
  chat: CHAT,
};

export function tipsFor(topic: TipTopic): readonly string[] {
  return TIPS[topic];
}

/** How long a wait may run before it is worth saying it is still working. */
export const LONG_WAIT_SECONDS = 20;
