import {
  DEFAULT_PREFERENCES,
  type AccessibilityPreferences,
  type AiDisclosure,
  type ChatMessage,
  type Citation,
  type Difficulty,
  type EvidenceItem,
  type LearningPlan,
  type Lesson,
  type LessonSection,
  type Material,
  type MaterialPage,
  type MisconceptionFinding,
  type PlanStep,
  type PracticeSet,
  type PracticeSetKind,
  type PracticeSetResult,
  type ProgressOverview,
  type Question,
  type QuestionFeedback,
  type SectionKind,
  type Topic,
  type TopicMastery,
} from '@educlm/contracts';
import seed from './fixtures/seed.json';
import {
  computeMastery,
  computeTrend,
  detectFindingsForTopic,
  type MockResponse,
} from './analytics';

/**
 * The mock's in-memory backend.
 *
 * It starts from the same seed the API's database does — same ids, same text,
 * same answer history — and then actually changes as the student works:
 * answering questions moves mastery, a repeated wrong tag becomes a finding,
 * and a finding on a weak topic adapts the plan. The demo path has to hold up
 * here with no server running.
 *
 * State is module-level, so a reload restores the seeded starting point.
 */

interface SeedPage {
  heading: string;
  body: string;
  kind: SectionKind;
  needsReview: boolean;
}

interface SeedTopic {
  id: string;
  slug: string;
  name: string;
  summary: string;
  firstPage: number;
  lastPage: number;
  prerequisiteSlugs: string[];
  pages: SeedPage[];
}

interface SeedQuestion {
  id: string;
  topicId: string;
  stem: string;
  page: number;
  difficulty: Difficulty;
  correct: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  options: { label: 'A' | 'B' | 'C' | 'D'; text: string; tag: string | null }[];
}

const SEED = seed as unknown as {
  material: { id: string; title: string; filename: string; pageCount: number };
  vocabulary: { tag: string; label: string; description: string }[];
  topics: SeedTopic[];
  questions: SeedQuestion[];
};

export const MATERIAL_ID = SEED.material.id;
const MODEL_LABEL = 'seed-fixture';
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number, hourOffset = 0): Date {
  return new Date(Date.now() - days * DAY + hourOffset * 60 * 60 * 1000);
}

function optionId(questionId: string, label: string): string {
  return `opt_${questionId}_${label.toLowerCase()}`;
}

const topicById = new Map(SEED.topics.map((topic) => [topic.id, topic]));
const questionById = new Map(SEED.questions.map((question) => [question.id, question]));
const vocabularyByTag = new Map(SEED.vocabulary.map((entry) => [entry.tag, entry]));

const pageText: Record<number, { heading: string; body: string }> = {};
for (const topic of SEED.topics) {
  topic.pages.forEach((page, index) => {
    pageText[topic.firstPage + index] = { heading: page.heading, body: page.body };
  });
}

function sourcePagesFor(topic: SeedTopic): number[] {
  return Array.from(
    { length: topic.lastPage - topic.firstPage + 1 },
    (_, index) => topic.firstPage + index,
  );
}

export function citationForPage(page: number): Citation {
  const content = pageText[page];
  const body = content?.body ?? '';
  return {
    chunkId: `chunk_p${page}`,
    page,
    sectionTitle: content?.heading ?? null,
    snippet: body.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

// ── Mutable state ────────────────────────────────────────────────────────────

interface MockPracticeSet {
  set: Omit<PracticeSet, 'questions' | 'answeredCount'>;
  questionIds: string[];
  answeredQuestionIds: Set<string>;
}

interface MockUpload {
  material: Material;
  startedAt: number;
  /** Set when the file should fail ingestion, e.g. a scan with no text layer. */
  failure: { code: 'NO_TEXT_LAYER'; message: string } | null;
}

interface MockState {
  materials: Material[];
  uploads: Map<string, MockUpload>;
  responses: MockResponse[];
  practiceSets: Map<string, MockPracticeSet>;
  findings: MisconceptionFinding[];
  plan: LearningPlan;
  chat: ChatMessage[];
  preferences: AccessibilityPreferences;
  responseSeq: number;
  setSeq: number;
}


/** The seed's answer history, response for response. */
const HISTORY: {
  topicId: string;
  questionIds: string[];
  results: boolean[];
  wrongTags: string[];
  startDaysAgo: number;
}[] = [
  {
    topicId: 'topic_variables',
    questionIds: [
      'q_variables_1',
      'q_variables_2',
      'q_variables_3',
      'q_variables_4',
      'q_variables_5',
      'q_variables_6',
    ],
    results: [true, true, true, true, true, true],
    wrongTags: [],
    startDaysAgo: 4,
  },
  {
    topicId: 'topic_functions',
    questionIds: [
      'q_functions_1',
      'q_functions_2',
      'q_functions_3',
      'q_functions_4',
      'q_functions_5',
      'q_functions_6',
    ],
    results: [true, false, true, false, true, true],
    wrongTags: ['scope_confusion', 'truthy_falsy'],
    startDaysAgo: 2,
  },
  {
    topicId: 'topic_conditionals',
    questionIds: [
      'q_conditionals_4',
      'q_conditionals_1',
      'q_conditionals_5',
      'q_conditionals_2',
      'q_conditionals_6',
      'q_conditionals_3',
    ],
    results: [false, false, true, false, true, false],
    wrongTags: [
      'assignment_vs_comparison',
      'assignment_vs_comparison',
      'assignment_vs_comparison',
      'assignment_vs_comparison',
    ],
    startDaysAgo: 1,
  },
];

function seededResponses(): { responses: MockResponse[]; sets: Map<string, MockPracticeSet> } {
  const responses: MockResponse[] = [];
  const sets = new Map<string, MockPracticeSet>();
  let sequence = 0;

  for (const block of HISTORY) {
    const setId = `set_${block.topicId}`;
    const topic = topicById.get(block.topicId);

    sets.set(setId, {
      set: {
        id: setId,
        materialId: MATERIAL_ID,
        topicId: block.topicId,
        topicName: topic?.name ?? null,
        kind: 'diagnostic',
        status: 'completed',
        reason: null,
        createdAt: daysAgo(block.startDaysAgo, -1).toISOString(),
        completedAt: daysAgo(block.startDaysAgo, 1).toISOString(),
      },
      questionIds: block.questionIds,
      answeredQuestionIds: new Set(block.questionIds),
    });

    let wrongIndex = 0;

    block.results.forEach((isCorrect, index) => {
      const questionId = block.questionIds[index]!;
      const question = questionById.get(questionId);
      if (!question) return;

      const distractorTags = question.options
        .map((option) => option.tag)
        .filter((tag): tag is string => tag !== null);

      // Read the wanted tag first: advancing the counter inside the predicate
      // would move it once per option tested rather than once per wrong answer.
      const wantedTag = isCorrect ? null : block.wrongTags[wrongIndex++];

      const selected = isCorrect
        ? question.options.find((option) => option.label === question.correct)
        : (question.options.find((option) => option.tag === wantedTag) ??
          question.options.find((option) => option.tag !== null));

      if (!selected) return;

      responses.push({
        id: `resp_seed_${++sequence}`,
        practiceSetId: setId,
        questionId,
        topicId: block.topicId,
        selectedOptionId: optionId(questionId, selected.label),
        isCorrect,
        misconceptionTag: isCorrect ? null : selected.tag,
        questionDistractorTags: distractorTags,
        answeredAt: daysAgo(block.startDaysAgo, index * 0.4),
      });
    });
  }

  return { responses, sets };
}

function seededPlan(): LearningPlan {
  const steps: PlanStep[] = [];
  const completedThrough = new Set([
    'topic_variables',
    'topic_data_types',
    'topic_operators',
    'topic_conditionals',
  ]);

  for (const topic of SEED.topics) {
    const done = completedThrough.has(topic.id);
    steps.push({
      id: `step_read_${topic.slug}`,
      kind: 'read',
      title: `Read: ${topic.name}`,
      description: topic.summary,
      topicId: topic.id,
      target: { type: 'lesson', id: topic.id },
      estimatedMinutes: 8,
      status: done ? 'completed' : 'pending',
      orderIndex: 0,
      insertedByAdaptation: false,
    });
    steps.push({
      id: `step_practice_${topic.slug}`,
      kind: 'practice',
      title: `Practise: ${topic.name}`,
      description: `A short set of questions on ${topic.name}.`,
      topicId: topic.id,
      target: { type: 'practice_set' },
      estimatedMinutes: 6,
      status: done ? 'completed' : 'pending',
      orderIndex: 0,
      insertedByAdaptation: false,
    });
  }

  const insertAt = steps.findIndex((step) => step.status === 'pending');
  steps.splice(
    insertAt,
    0,
    {
      id: 'step_adapt_review_conditionals',
      kind: 'review',
      title: 'Review: Conditionals',
      description:
        'A focused re-read of Conditionals, aimed at confusing assignment with comparison.',
      topicId: 'topic_conditionals',
      target: { type: 'lesson', id: 'topic_conditionals' },
      estimatedMinutes: 6,
      status: 'active',
      orderIndex: 0,
      insertedByAdaptation: true,
    },
    {
      id: 'step_adapt_practice_conditionals',
      kind: 'practice',
      title: 'Focused practice: Conditionals',
      description:
        '5 questions on Conditionals, weighted toward the ones that trip up confusing assignment with comparison.',
      topicId: 'topic_conditionals',
      target: { type: 'practice_set' },
      estimatedMinutes: 8,
      status: 'pending',
      orderIndex: 0,
      insertedByAdaptation: true,
    },
  );

  return {
    id: 'plan_demo_js',
    materialId: MATERIAL_ID,
    steps: steps.map((step, orderIndex) => ({ ...step, orderIndex })),
    currentStepId: 'step_adapt_review_conditionals',
    lastAdaptation: {
      at: daysAgo(1, 2).toISOString(),
      reason: 'Confusing assignment with comparison in 3 of your last 5 answers',
      triggeredByFindingId: 'finding_conditionals_avc',
      previousStepTitle: 'Read: Loops',
      newStepTitle: 'Review: Conditionals',
    },
  };
}

function initialState(): MockState {
  const { responses, sets } = seededResponses();
  const detected = detectFindingsForTopic('topic_conditionals', responses).find(
    (finding) => finding.tag === 'assignment_vs_comparison',
  );
  const vocabulary = vocabularyByTag.get('assignment_vs_comparison');

  const findings: MisconceptionFinding[] =
    detected && vocabulary
      ? [
          {
            id: 'finding_conditionals_avc',
            topicId: 'topic_conditionals',
            topicName: topicById.get('topic_conditionals')?.name ?? 'Conditionals',
            tag: detected.tag,
            label: vocabulary.label,
            description: vocabulary.description,
            occurrences: detected.occurrences,
            windowSize: detected.windowSize,
            evidence: detected.evidenceResponseIds
              .map((id) => evidenceFor(id, responses))
              .filter((item): item is EvidenceItem => item !== null),
            status: 'active',
            detectedAt: daysAgo(1, 2).toISOString(),
          },
        ]
      : [];

  return {
    // The library starts empty so the app opens on its invitation to add a
    // PDF, rather than on someone else's sample. The seeded content and history
    // below are still here — whatever is uploaded resolves to them.
    materials: [],
    uploads: new Map(),
    responses,
    practiceSets: sets,
    findings,
    plan: seededPlan(),
    chat: [],
    preferences: { ...DEFAULT_PREFERENCES },
    responseSeq: responses.length,
    setSeq: 0,
  };
}

function evidenceFor(responseId: string, responses: MockResponse[]): EvidenceItem | null {
  const response = responses.find((item) => item.id === responseId);
  if (!response) return null;

  const question = questionById.get(response.questionId);
  if (!question) return null;

  const selected = question.options.find(
    (option) => optionId(question.id, option.label) === response.selectedOptionId,
  );
  const correct = question.options.find((option) => option.label === question.correct);

  return {
    responseId: response.id,
    questionId: response.questionId,
    questionStem: question.stem,
    selectedOptionLabel: selected?.label ?? '?',
    selectedOptionText: selected?.text ?? '',
    correctOptionText: correct?.text ?? '',
    sourcePage: question.page,
    answeredAt: response.answeredAt.toISOString(),
  };
}

let state: MockState = initialState();

export function resetStore(): void {
  state = initialState();
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function listMaterials(): Material[] {
  return [...state.materials].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findMaterial(id: string): Material | undefined {
  advanceUploads();
  return state.materials.find((material) => material.id === id);
}

export function topicMasteryFor(topicId: string): TopicMastery | null {
  const topic = topicById.get(topicId);
  if (!topic) return null;

  const computed = computeMastery(topicId, state.responses);
  if (computed.totalCount === 0) return null;

  return { topicId, topicName: topic.name, ...computed };
}

/**
 * The sample topics, under whichever material asked for them.
 *
 * The mock holds one body of content and one history; every other lookup here
 * (lesson, pages, plan, progress) is already global. Gating only this one on the
 * seed's id made an uploaded material come back with no topics at all — a ready
 * course with nothing in it. Answering for any id is what lets the library start
 * empty and a file you add behave like a real one.
 */
export function listTopics(materialId: string): Topic[] {
  return SEED.topics.map((topic, orderIndex) => ({
    id: topic.id,
    materialId,
    name: topic.name,
    slug: topic.slug,
    summary: topic.summary,
    orderIndex,
    sourcePages: sourcePagesFor(topic),
    prerequisiteTopicIds: topic.prerequisiteSlugs
      .map((slug) => SEED.topics.find((candidate) => candidate.slug === slug)?.id)
      .filter((id): id is string => Boolean(id)),
    questionCount: SEED.questions.filter((question) => question.topicId === topic.id).length,
    mastery: topicMasteryFor(topic.id),
  }));
}

export function getLesson(topicId: string): Lesson | null {
  const topic = topicById.get(topicId);
  if (!topic) return null;

  const sections: LessonSection[] = topic.pages.map((page, index) => ({
    id: `sec_${topic.slug}_${index + 1}`,
    topicId: topic.id,
    heading: page.heading,
    level: 2,
    bodyMarkdown: page.body,
    orderIndex: index,
    sourcePages: [topic.firstPage + index],
    kind: page.kind,
    needsReview: page.needsReview,
  }));

  const words = sections.reduce(
    (total, section) => total + section.bodyMarkdown.split(/\s+/).length,
    0,
  );

  return {
    topicId: topic.id,
    topicName: topic.name,
    readingTimeMinutes: Math.max(1, Math.round(words / 180)),
    sections,
    generatedBy: MODEL_LABEL,
    generatedAt: daysAgo(5).toISOString(),
  };
}

export function getPage(page: number): MaterialPage | null {
  const content = pageText[page];
  if (!content) {
    // Pages between topics exist in the PDF but carry no extracted text.
    return page >= 1 && page <= SEED.material.pageCount
      ? { page, text: '', imageUrl: null }
      : null;
  }
  return { page, text: `${content.heading}\n\n${content.body}`, imageUrl: null };
}

export function progressOverview(materialId: string): ProgressOverview {
  const masteryByTopic = SEED.topics
    .map((topic) => topicMasteryFor(topic.id))
    .filter((mastery): mastery is TopicMastery => mastery !== null)
    .sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });

  const active = state.findings.filter((finding) => finding.status === 'active');
  const ranked = [...active].sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return b.detectedAt.localeCompare(a.detectedAt);
  });

  const correct = state.responses.filter((response) => response.isCorrect).length;

  return {
    materialId,
    masteryByTopic,
    topFinding: ranked[0] ?? null,
    plan: state.plan,
    trend: computeTrend(state.responses),
    totals: {
      responseCount: state.responses.length,
      practiceSetsCompleted: [...state.practiceSets.values()].filter(
        (entry) => entry.set.status === 'completed',
      ).length,
      accuracy: state.responses.length === 0 ? null : correct / state.responses.length,
    },
  };
}

export function getFinding(id: string): MisconceptionFinding | undefined {
  return state.findings.find((finding) => finding.id === id);
}

export function dismissFinding(id: string): MisconceptionFinding | undefined {
  const finding = state.findings.find((entry) => entry.id === id);
  if (!finding) return undefined;
  finding.status = 'dismissed';
  return finding;
}

export function getPlan(): LearningPlan {
  return state.plan;
}

export function getChat(): ChatMessage[] {
  return state.chat;
}

export function getPreferences(): AccessibilityPreferences {
  return state.preferences;
}

export function topicProgress(topicId: string) {
  const mastery = topicMasteryFor(topicId);
  const topic = topicById.get(topicId);

  return {
    mastery: mastery ?? {
      topicId,
      topicName: topic?.name ?? 'Unknown topic',
      band: 'insufficient_data' as const,
      score: null,
      confidence: 'none' as const,
      correctCount: 0,
      totalCount: 0,
      lastAnsweredAt: null,
    },
    findings: state.findings.filter((finding) => finding.topicId === topicId),
    recentResponses: state.responses
      .filter((response) => response.topicId === topicId)
      .sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime())
      .slice(0, 10)
      .map((response) => {
        const question = questionById.get(response.questionId);
        const selected = question?.options.find(
          (option) => optionId(question.id, option.label) === response.selectedOptionId,
        );
        return {
          responseId: response.id,
          questionId: response.questionId,
          questionStem: question?.stem ?? '',
          isCorrect: response.isCorrect,
          selectedOptionLabel: selected?.label ?? '?',
          answeredAt: response.answeredAt.toISOString(),
        };
      }),
  };
}

// ── Uploads ──────────────────────────────────────────────────────────────────

const STAGES: { stage: Material['processing'] extends null ? never : string; message: string }[] =
  [
    { stage: 'extracting', message: 'Reading the pages' },
    { stage: 'chunking', message: 'Splitting the text into passages' },
    { stage: 'extracting_topics', message: 'Finding the topics' },
    { stage: 'embedding', message: 'Indexing the material so the agent can cite it' },
    { stage: 'building_lessons', message: 'Building the accessible lesson' },
  ];

/** Ingestion takes about 8 seconds and walks the real stages. */
const UPLOAD_DURATION_MS = 8_000;

export function startUpload(filename: string, title: string | null, failNoText: boolean): Material {
  advanceUploads();

  const id = `mat_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();

  const material: Material = {
    id,
    title: title || filename.replace(/\.pdf$/i, ''),
    originalFilename: filename,
    status: 'processing',
    pageCount: null,
    topicCount: 0,
    processing: { stage: 'extracting', percent: 0, message: STAGES[0]!.message },
    failure: null,
    createdAt: now,
    updatedAt: now,
  };

  state.materials.push(material);
  state.uploads.set(id, {
    material,
    startedAt: Date.now(),
    failure: failNoText
      ? {
          code: 'NO_TEXT_LAYER',
          message:
            "This PDF is a scanned image, so there's no text to read. Try a file where you can select the text.",
        }
      : null,
  });

  return material;
}

/** Moves every in-flight upload to where it should be by now. */
export function advanceUploads(): void {
  for (const [id, upload] of state.uploads) {
    const elapsed = Date.now() - upload.startedAt;
    const material = state.materials.find((entry) => entry.id === id);
    if (!material) {
      state.uploads.delete(id);
      continue;
    }

    if (elapsed >= UPLOAD_DURATION_MS) {
      if (upload.failure) {
        material.status = 'failed';
        material.processing = null;
        material.failure = upload.failure;
      } else {
        material.status = 'ready';
        material.processing = null;
        material.pageCount = 24;
        material.topicCount = 5;
      }
      material.updatedAt = new Date().toISOString();
      state.uploads.delete(id);
      continue;
    }

    const progress = elapsed / UPLOAD_DURATION_MS;
    const index = Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length));
    const stage = STAGES[index]!;

    material.status = 'processing';
    material.processing = {
      stage: stage.stage as NonNullable<Material['processing']>['stage'],
      percent: Math.min(99, Math.round(progress * 100)),
      message: stage.message,
    };
    material.updatedAt = new Date().toISOString();
  }
}

export function deleteMaterial(id: string): boolean {
  const index = state.materials.findIndex((material) => material.id === id);
  if (index === -1) return false;
  state.materials.splice(index, 1);
  state.uploads.delete(id);

  // One body of history, so deleting whichever material was holding it clears
  // it. Previously this only fired for the seed's id, which left an uploaded
  // material's answers behind after it was removed.
  state.responses = [];
  state.findings = [];
  state.practiceSets.clear();

  return true;
}

// ── Practice ─────────────────────────────────────────────────────────────────

function toQuestion(question: SeedQuestion): Question {
  return {
    id: question.id,
    materialId: MATERIAL_ID,
    topicId: question.topicId,
    topicName: topicById.get(question.topicId)?.name ?? '',
    stem: question.stem,
    options: question.options.map((option) => ({
      id: optionId(question.id, option.label),
      label: option.label,
      text: option.text,
    })),
    difficulty: question.difficulty,
    sourcePage: question.page,
  };
}

function hydrate(entry: MockPracticeSet): PracticeSet {
  return {
    ...entry.set,
    questions: entry.questionIds
      .map((id) => questionById.get(id))
      .filter((question): question is SeedQuestion => Boolean(question))
      .map(toQuestion),
    answeredCount: entry.answeredQuestionIds.size,
  };
}

export function createPracticeSet(input: {
  materialId: string;
  kind: PracticeSetKind;
  topicId?: string;
  count?: number;
}): PracticeSet {
  const count = input.count ?? 5;
  const topic = input.topicId ? topicById.get(input.topicId) : undefined;

  let pool = SEED.questions.filter((question) =>
    input.topicId ? question.topicId === input.topicId : true,
  );

  if (input.kind === 'retry') {
    // Retry asks again about the questions that were answered wrongly.
    const wrong = new Set(
      state.responses.filter((response) => !response.isCorrect).map((r) => r.questionId),
    );
    const retryPool = pool.filter((question) => wrong.has(question.id));
    if (retryPool.length > 0) pool = retryPool;
  }

  if (input.kind === 'focused' && input.topicId) {
    // Weight toward questions that carry the topic's active misconception.
    const tags = new Set(
      state.findings
        .filter((finding) => finding.topicId === input.topicId && finding.status === 'active')
        .map((finding) => finding.tag),
    );
    pool = [...pool].sort((a, b) => {
      const score = (question: SeedQuestion) =>
        question.options.some((option) => option.tag && tags.has(option.tag)) ? 0 : 1;
      return score(a) - score(b);
    });
  }

  const questionIds = pool.slice(0, count).map((question) => question.id);
  const id = `set_mock_${++state.setSeq}_${Date.now().toString(36)}`;

  const reason =
    input.kind === 'focused' && topic
      ? `Focused on ${topic.name}, where your recent answers show a pattern.`
      : input.kind === 'retry'
        ? 'A second attempt at the questions you answered incorrectly.'
        : null;

  const entry: MockPracticeSet = {
    set: {
      id,
      materialId: input.materialId,
      topicId: input.topicId ?? null,
      topicName: topic?.name ?? null,
      kind: input.kind,
      status: 'in_progress',
      reason,
      createdAt: new Date().toISOString(),
      completedAt: null,
    },
    questionIds,
    answeredQuestionIds: new Set(),
  };

  state.practiceSets.set(id, entry);
  return hydrate(entry);
}

export function getPracticeSet(id: string): PracticeSet | undefined {
  const entry = state.practiceSets.get(id);
  return entry ? hydrate(entry) : undefined;
}

export function submitResponse(
  setId: string,
  input: { questionId: string; selectedOptionId: string; timeSpentMs: number },
): QuestionFeedback | undefined {
  const entry = state.practiceSets.get(setId);
  const question = questionById.get(input.questionId);
  if (!entry || !question) return undefined;

  const selected = question.options.find(
    (option) => optionId(question.id, option.label) === input.selectedOptionId,
  );
  if (!selected) return undefined;

  const isCorrect = selected.label === question.correct;
  const correctOption = question.options.find((option) => option.label === question.correct)!;
  const responseId = `resp_mock_${++state.responseSeq}`;

  state.responses.push({
    id: responseId,
    practiceSetId: setId,
    questionId: question.id,
    topicId: question.topicId,
    selectedOptionId: input.selectedOptionId,
    isCorrect,
    misconceptionTag: isCorrect ? null : selected.tag,
    questionDistractorTags: question.options
      .map((option) => option.tag)
      .filter((tag): tag is string => tag !== null),
    answeredAt: new Date(),
  });

  entry.answeredQuestionIds.add(question.id);

  const vocabulary = !isCorrect && selected.tag ? vocabularyByTag.get(selected.tag) : undefined;

  return {
    questionId: question.id,
    selectedOptionId: input.selectedOptionId,
    correctOptionId: optionId(question.id, correctOption.label),
    isCorrect,
    explanationMarkdown: question.explanation,
    citation: citationForPage(question.page),
    misconception: vocabulary
      ? {
          tag: vocabulary.tag,
          label: vocabulary.label,
          description: vocabulary.description,
        }
      : null,
    responseId,
  };
}

/**
 * Completing a set is the moment the engine reacts: findings are recomputed,
 * and a finding on a weak topic inserts a review + focused practice pair ahead
 * of the next pending step.
 */
export function completePracticeSet(setId: string): PracticeSetResult | undefined {
  const entry = state.practiceSets.get(setId);
  if (!entry) return undefined;

  entry.set.status = 'completed';
  entry.set.completedAt = new Date().toISOString();

  const responses = state.responses.filter((response) => response.practiceSetId === setId);
  const byTopic = new Map<string, { correct: number; total: number }>();

  for (const response of responses) {
    const bucket = byTopic.get(response.topicId) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (response.isCorrect) bucket.correct += 1;
    byTopic.set(response.topicId, bucket);
  }

  const newFindings: MisconceptionFinding[] = [];

  for (const topicId of byTopic.keys()) {
    for (const detected of detectFindingsForTopic(topicId, state.responses)) {
      const vocabulary = vocabularyByTag.get(detected.tag);
      if (!vocabulary) continue;

      const existing = state.findings.find(
        (finding) => finding.topicId === topicId && finding.tag === detected.tag,
      );

      const evidence = detected.evidenceResponseIds
        .map((id) => evidenceFor(id, state.responses))
        .filter((item): item is EvidenceItem => item !== null);

      if (existing) {
        existing.occurrences = detected.occurrences;
        existing.windowSize = detected.windowSize;
        existing.evidence = evidence;
        continue;
      }

      const finding: MisconceptionFinding = {
        id: `finding_${topicId}_${detected.tag}`,
        topicId,
        topicName: topicById.get(topicId)?.name ?? '',
        tag: detected.tag,
        label: vocabulary.label,
        description: vocabulary.description,
        occurrences: detected.occurrences,
        windowSize: detected.windowSize,
        evidence,
        status: 'active',
        detectedAt: new Date().toISOString(),
      };

      state.findings.push(finding);
      newFindings.push(finding);
    }
  }

  const planUpdated = adaptPlan();

  return {
    setId,
    correctCount: responses.filter((response) => response.isCorrect).length,
    total: responses.length,
    byTopic: [...byTopic.entries()].map(([topicId, counts]) => ({
      topicId,
      topicName: topicById.get(topicId)?.name ?? '',
      correct: counts.correct,
      total: counts.total,
    })),
    newFindings,
    planUpdated,
  };
}

function adaptPlan(): boolean {
  const liveAdaptationTopics = new Set(
    state.plan.steps
      .filter(
        (step) =>
          step.insertedByAdaptation &&
          step.topicId !== null &&
          (step.status === 'pending' || step.status === 'active'),
      )
      .map((step) => step.topicId as string),
  );

  const eligible = state.findings.find((finding) => {
    if (finding.status !== 'active') return false;
    if (liveAdaptationTopics.has(finding.topicId)) return false;
    return computeMastery(finding.topicId, state.responses).band === 'needs_attention';
  });

  if (!eligible) return false;

  const topicName = eligible.topicName || 'this topic';
  const insertAt = state.plan.steps.findIndex((step) => step.status === 'pending');
  const previousStepTitle = state.plan.steps[insertAt]?.title ?? 'the next step';

  const review: PlanStep = {
    id: `step_adapt_review_${eligible.topicId}`,
    kind: 'review',
    title: `Review: ${topicName}`,
    description: `A focused re-read of ${topicName}, aimed at ${eligible.label.toLowerCase()}.`,
    topicId: eligible.topicId,
    target: { type: 'lesson', id: eligible.topicId },
    estimatedMinutes: 6,
    status: 'pending',
    orderIndex: 0,
    insertedByAdaptation: true,
  };

  const practice: PlanStep = {
    id: `step_adapt_practice_${eligible.topicId}`,
    kind: 'practice',
    title: `Focused practice: ${topicName}`,
    description: `5 questions on ${topicName}, weighted toward the ones that trip up ${eligible.label.toLowerCase()}.`,
    topicId: eligible.topicId,
    target: { type: 'practice_set' },
    estimatedMinutes: 8,
    status: 'pending',
    orderIndex: 0,
    insertedByAdaptation: true,
  };

  const steps = [...state.plan.steps];
  steps.splice(insertAt === -1 ? steps.length : insertAt, 0, review, practice);

  state.plan = {
    ...state.plan,
    steps: steps.map((step, orderIndex) => ({ ...step, orderIndex })),
    currentStepId: review.id,
    lastAdaptation: {
      at: new Date().toISOString(),
      reason: `${eligible.label} in ${eligible.occurrences} of your last ${eligible.windowSize} answers`,
      triggeredByFindingId: eligible.id,
      previousStepTitle,
      newStepTitle: review.title,
    },
  };

  return true;
}

// ── Plan mutations ───────────────────────────────────────────────────────────

function setStepStatus(stepId: string, status: PlanStep['status']): LearningPlan | undefined {
  const index = state.plan.steps.findIndex((step) => step.id === stepId);
  if (index === -1) return undefined;

  const steps = state.plan.steps.map((step) =>
    step.id === stepId ? { ...step, status } : step,
  );

  const nextPending = steps.find((step) => step.status === 'pending');
  if (nextPending) nextPending.status = 'active';

  state.plan = {
    ...state.plan,
    steps,
    currentStepId: nextPending?.id ?? null,
  };

  return state.plan;
}

export function completeStep(stepId: string): LearningPlan | undefined {
  return setStepStatus(stepId, 'completed');
}

export function skipStep(stepId: string): LearningPlan | undefined {
  return setStepStatus(stepId, 'skipped');
}

/** Removes the inserted steps and puts the original next step back in front. */
export function revertAdaptation(): LearningPlan {
  const steps = state.plan.steps.filter(
    (step) => !(step.insertedByAdaptation && step.status !== 'completed'),
  );

  const nextPending = steps.find(
    (step) => step.status === 'pending' || step.status === 'active',
  );
  if (nextPending) nextPending.status = 'active';

  state.plan = {
    ...state.plan,
    steps: steps.map((step, orderIndex) => ({ ...step, orderIndex })),
    currentStepId: nextPending?.id ?? null,
    lastAdaptation: null,
  };

  return state.plan;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','of','to','in','is','it','and','or','how','what','why','do','does','i','you','me',
  'explain','simply','give','example','summarise','summarize','this','section','make','practice',
  'questions','about','for','with','on','can','my','please',
]);

/** Keyword overlap against the page text — the mock's stand-in for retrieval. */
function retrieve(query: string, topicId?: string): number[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9=+*/<>!]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));

  const topic = topicId ? topicById.get(topicId) : undefined;
  const candidatePages = topic
    ? sourcePagesFor(topic)
    : Object.keys(pageText).map((page) => Number(page));

  const scored = candidatePages
    .map((page) => {
      const content = pageText[page];
      if (!content) return { page, score: 0 };
      const haystack = `${content.heading} ${content.body}`.toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { page, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 3).map((entry) => entry.page);
  return top.length > 0 ? top : candidatePages.slice(0, 2);
}

export interface MockAnswer {
  text: string;
  citations: Citation[];
}

/**
 * Intent classification, mirroring `apps/api/src/modules/agent/chat.ts`.
 *
 * Kept in step with the backend on purpose: a greeting answered with "I can't
 * find that in this material" is the same bug in mock mode as in live mode, and
 * mock mode is what a first-time visitor sees. The patterns are anchored to the
 * whole message so anything carrying a real question stays on the retrieval
 * path — "what can you do with arrays?" is about the material, not about EDU.
 */
type ChatIntent = 'greeting' | 'capability' | 'material';

const GREETING_ONLY =
  /^(?:hi|hey|hello|yo|hiya|sup|good\s(?:morning|afternoon|evening)|thanks?|thank\syou|ty|cheers|ok(?:ay)?|cool|nice|great|bye|goodbye|see\sya)[\s!.,?]*$/i;

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

function classifyIntent(message: string): ChatIntent {
  const trimmed = message.trim();
  if (GREETING_ONLY.test(trimmed)) return 'greeting';
  if (CAPABILITY_PATTERNS.some((pattern) => pattern.test(trimmed))) return 'capability';
  return 'material';
}

/** Every line maps to something the API actually serves. */
const CAPABILITIES = [
  'Explain any part of the material in plain language, marking the page each point came from.',
  'Work through a hard idea one step at a time, and check understanding as we go.',
  'Build practice questions from the material and mark them with feedback.',
  'Point to the progress screen: how each topic is going, accuracy over time, and the specific misunderstandings the answers reveal.',
  'Keep a study plan that adapts as practice happens.',
];

function conversationalAnswer(
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

/**
 * Answers only from the material: the reply is assembled out of the pages that
 * matched, so every sentence has a page behind it, exactly as the live agent's
 * grounding rule requires.
 */
export function answerQuestion(
  question: string,
  topicId?: string,
  materialId?: string,
): MockAnswer {
  // Conversation rather than coursework: nothing to retrieve, nothing to cite.
  // The title is looked up rather than taken from the fixture, so a material
  // uploaded in mock mode is greeted by its own name.
  const intent = classifyIntent(question);
  if (intent !== 'material') {
    const title = (materialId ? findMaterial(materialId)?.title : undefined) ?? null;
    return { text: conversationalAnswer(intent, title), citations: [] };
  }

  const pages = retrieve(question, topicId);
  const citations = pages.map(citationForPage);
  const primary = pages[0] !== undefined ? pageText[pages[0]] : undefined;

  if (!primary) {
    return {
      text: "I can't find that in this material, so I won't guess at it.\n\nTry rephrasing it, or ask about one of the topics in the list. I can also build practice questions from what it does cover, or show you how each topic is going.",
      citations: [],
    };
  }

  const sentences = primary.body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const body = sentences.slice(0, 4).join('\n\n');
  const second = pages[1] !== undefined ? pageText[pages[1]] : undefined;

  const extra = second ? `\n\nThere's more on this under "${second.heading}".` : '';

  return {
    text: `Here's what your material says under "${primary.heading}":\n\n${body}${extra}`,
    citations,
  };
}

export function appendChatMessage(message: ChatMessage): void {
  state.chat.push(message);
}

export function clearChat(): void {
  state.chat = [];
}

export function nextChatId(): string {
  return `msg_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Preferences ──────────────────────────────────────────────────────────────

export function updatePreferences(
  patch: Omit<Partial<AccessibilityPreferences>, 'readAloud'> & {
    readAloud?: Partial<AccessibilityPreferences['readAloud']> | undefined;
  },
): AccessibilityPreferences {
  state.preferences = {
    ...state.preferences,
    ...patch,
    readAloud: { ...state.preferences.readAloud, ...(patch.readAloud ?? {}) },
  };
  return state.preferences;
}

export const AI_DISCLOSURE: AiDisclosure = {
  models: [
    {
      purpose: 'Lesson rewriting, question generation and tutor answers',
      provider: 'Groq',
      model: 'llama-3.3-70b-versatile',
    },
    {
      purpose: 'Passage embeddings for source retrieval',
      provider: 'Local (Transformers.js)',
      model: 'Xenova/bge-small-en-v1.5',
    },
  ],
  // Mirrors the list apps/api/src/routes/meta.ts serves, so the disclosure page
  // reads the same in both modes.
  libraries: [
    { name: 'Fastify', license: 'MIT', url: 'https://fastify.dev' },
    { name: 'Prisma', license: 'Apache-2.0', url: 'https://www.prisma.io' },
    {
      name: 'PostgreSQL + pgvector',
      license: 'PostgreSQL / MIT',
      url: 'https://github.com/pgvector/pgvector',
    },
    { name: 'PGlite', license: 'Apache-2.0', url: 'https://pglite.dev' },
    { name: 'Vercel AI SDK', license: 'Apache-2.0', url: 'https://sdk.vercel.ai' },
    {
      name: 'Transformers.js',
      license: 'Apache-2.0',
      url: 'https://huggingface.co/docs/transformers.js',
    },
    {
      name: 'BAAI/bge-small-en-v1.5',
      license: 'MIT',
      url: 'https://huggingface.co/BAAI/bge-small-en-v1.5',
    },
    { name: 'unpdf', license: 'MIT', url: 'https://github.com/unjs/unpdf' },
    { name: 'Zod', license: 'MIT', url: 'https://zod.dev' },
    { name: 'p-queue', license: 'MIT', url: 'https://github.com/sindresorhus/p-queue' },
  ],
};
