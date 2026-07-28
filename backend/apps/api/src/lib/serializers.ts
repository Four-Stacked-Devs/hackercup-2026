import type {
  ApiErrorCode,
  Citation,
  Confidence,
  Difficulty,
  FindingStatus,
  IngestionStage,
  LearningPlan,
  Lesson,
  LessonSection,
  MasteryBand,
  Material,
  MaterialFailure,
  MaterialProcessing,
  MaterialStatus,
  MisconceptionFinding,
  OptionLabel,
  PlanStep,
  PlanStepKind,
  PlanStepStatus,
  PracticeSetKind,
  PracticeSetStatus,
  Question,
  SectionKind,
  TopicMastery,
} from '@educlm/contracts';
import type * as P from '../generated/prisma/client.js';
import type { MasteryResult } from '../modules/analytics/index.js';

/**
 * The serialization boundary.
 *
 * Prisma enums are SCREAMING_CASE; the wire is lowercase snake_case. Every
 * conversion happens here and nowhere else, so a Prisma value can never leak
 * into a response.
 */

const lower = <T extends string>(value: string): T => value.toLowerCase() as T;
const upper = (value: string): string => value.toUpperCase();

export const toWire = {
  materialStatus: (v: P.MaterialStatus): MaterialStatus => lower(v),
  ingestionStage: (v: P.IngestionStage): IngestionStage => lower(v),
  difficulty: (v: P.Difficulty): Difficulty => lower(v),
  sectionKind: (v: P.SectionKind): SectionKind => lower(v),
  practiceSetKind: (v: P.PracticeSetKind): PracticeSetKind => lower(v),
  practiceSetStatus: (v: P.PracticeSetStatus): PracticeSetStatus => lower(v),
  planStepKind: (v: P.PlanStepKind): PlanStepKind => lower(v),
  planStepStatus: (v: P.PlanStepStatus): PlanStepStatus => lower(v),
  findingStatus: (v: P.FindingStatus): FindingStatus => lower(v),
};

export const fromWire = {
  difficulty: (v: Difficulty) => upper(v) as P.Difficulty,
  practiceSetKind: (v: PracticeSetKind) => upper(v) as P.PracticeSetKind,
  practiceSetStatus: (v: PracticeSetStatus) => upper(v) as P.PracticeSetStatus,
  planStepStatus: (v: PlanStepStatus) => upper(v) as P.PlanStepStatus,
  findingStatus: (v: FindingStatus) => upper(v) as P.FindingStatus,
  sectionKind: (v: SectionKind) => upper(v) as P.SectionKind,
};

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();

// ─── Material ────────────────────────────────────────────────────────────────

const STAGE_MESSAGES: Record<P.IngestionStage, string> = {
  EXTRACTING: 'Reading the pages',
  CHUNKING: 'Splitting it into readable pieces',
  EXTRACTING_TOPICS: 'Working out the topics',
  EMBEDDING: 'Indexing it so you can ask questions',
  BUILDING_LESSONS: 'Rewriting it into accessible lessons',
  DONE: 'Ready',
};

function buildProcessing(row: P.Material): MaterialProcessing | null {
  if (row.status !== 'PROCESSING' || !row.stage) return null;
  return {
    stage: toWire.ingestionStage(row.stage),
    percent: row.stagePercent,
    message: STAGE_MESSAGES[row.stage],
  };
}

function buildFailure(row: P.Material): MaterialFailure | null {
  if (row.status !== 'FAILED' || !row.failureCode) return null;
  return {
    code: row.failureCode as ApiErrorCode,
    message: row.failureMessage ?? 'Something went wrong while preparing this file.',
  };
}

export function toMaterial(row: P.Material, topicCount: number): Material {
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    status: toWire.materialStatus(row.status),
    pageCount: row.pageCount,
    topicCount,
    processing: buildProcessing(row),
    failure: buildFailure(row),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toMaterialStatus(row: P.Material) {
  return {
    status: toWire.materialStatus(row.status),
    processing: buildProcessing(row),
    failure: buildFailure(row),
  };
}

// ─── Mastery ─────────────────────────────────────────────────────────────────

export function toTopicMastery(result: MasteryResult, topicName: string): TopicMastery {
  return {
    topicId: result.topicId,
    topicName,
    band: result.band as MasteryBand,
    score: result.score,
    confidence: result.confidence as Confidence,
    correctCount: result.correctCount,
    totalCount: result.totalCount,
    lastAnsweredAt: isoOrNull(result.lastAnsweredAt),
  };
}

// ─── Lessons ─────────────────────────────────────────────────────────────────

export function toLessonSection(row: P.LessonSection): LessonSection {
  return {
    id: row.id,
    topicId: row.topicId,
    heading: row.heading,
    level: row.level === 3 ? 3 : 2,
    bodyMarkdown: row.bodyMarkdown,
    orderIndex: row.orderIndex,
    sourcePages: row.sourcePages,
    kind: toWire.sectionKind(row.kind),
    needsReview: row.needsReview,
  };
}

/** ~200 words per minute, floored at 1 so nothing reads as "0 min". */
export function estimateReadingMinutes(sections: { bodyMarkdown: string }[]): number {
  const words = sections.reduce(
    (total, s) => total + s.bodyMarkdown.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return Math.max(1, Math.round(words / 200));
}

export function toLesson(
  topic: P.Topic,
  sections: P.LessonSection[],
  generatedBy: string,
  generatedAt: Date,
): Lesson {
  const ordered = [...sections].sort((a, b) => a.orderIndex - b.orderIndex);
  return {
    topicId: topic.id,
    topicName: topic.name,
    readingTimeMinutes: estimateReadingMinutes(ordered),
    sections: ordered.map(toLessonSection),
    generatedBy,
    generatedAt: iso(generatedAt),
  };
}

// ─── Questions ───────────────────────────────────────────────────────────────

/**
 * Strips `correctOptionId`, `explanation`, and every `misconceptionTag`.
 *
 * Answer-checking is server-side only: the correct answer must never reach the
 * client before submission, or a judge with devtools open can read the quiz.
 */
export function toQuestion(
  row: P.Question & { options: P.QuestionOption[] },
  topicName: string,
): Question {
  return {
    id: row.id,
    materialId: row.materialId,
    topicId: row.topicId,
    topicName,
    stem: row.stem,
    options: [...row.options]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((o) => ({ id: o.id, label: o.label as OptionLabel, text: o.text })),
    difficulty: toWire.difficulty(row.difficulty),
    sourcePage: row.sourcePage,
  };
}

// ─── Findings ────────────────────────────────────────────────────────────────

export function toMisconceptionFinding(
  row: P.MisconceptionFinding,
  topicName: string,
  evidence: MisconceptionFinding['evidence'],
): MisconceptionFinding {
  return {
    id: row.id,
    topicId: row.topicId,
    topicName,
    tag: row.tag,
    label: row.label,
    description: row.description,
    occurrences: row.occurrences,
    windowSize: row.windowSize,
    evidence,
    status: toWire.findingStatus(row.status),
    detectedAt: iso(row.detectedAt),
  };
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export function toPlanStep(row: P.PlanStep): PlanStep {
  const target: PlanStep['target'] = row.targetType
    ? {
        type: row.targetType as 'lesson' | 'practice_set' | 'page',
        ...(row.targetId ? { id: row.targetId } : {}),
        ...(row.targetPage !== null ? { page: row.targetPage } : {}),
      }
    : null;

  return {
    id: row.id,
    kind: toWire.planStepKind(row.kind),
    title: row.title,
    description: row.description,
    topicId: row.topicId,
    target,
    estimatedMinutes: row.estimatedMinutes,
    status: toWire.planStepStatus(row.status),
    orderIndex: row.orderIndex,
    insertedByAdaptation: row.insertedByAdaptation,
  };
}

export function toLearningPlan(
  row: P.LearningPlan,
  steps: P.PlanStep[],
): LearningPlan {
  return {
    id: row.id,
    materialId: row.materialId,
    steps: [...steps].sort((a, b) => a.orderIndex - b.orderIndex).map(toPlanStep),
    currentStepId: row.currentStepId,
    lastAdaptation: (row.lastAdaptation as LearningPlan['lastAdaptation']) ?? null,
  };
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export function toChatMessage(row: P.ChatMessage) {
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    citations: (row.citations as Citation[]) ?? [],
    createdAt: iso(row.createdAt),
  };
}
