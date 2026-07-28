import type {
  Confidence,
  FindingStatus,
  MasteryBand,
  PlanStepKind,
  PlanStepStatus,
  TrendDirection,
} from '@educlm/contracts';

/**
 * Inputs to the analytics engine are plain objects — never Prisma rows.
 * This module must not import Prisma, `fetch`, or any LLM client.
 */
export interface ResponseInput {
  id: string;
  topicId: string;
  questionId: string;
  isCorrect: boolean;
  misconceptionTag: string | null;
  attemptNumber: number;
  answeredAt: Date;
  /**
   * Every misconception tag that appeared as a distractor on this question.
   *
   * Added beyond the spec's ResponseInput because finding resolution is defined
   * as "3 consecutive correct answers on questions that carried it as a
   * distractor" — which is impossible to evaluate without knowing which
   * questions those were. Optional so older callers still typecheck.
   */
  questionDistractorTags?: string[];
}

export interface MasteryResult {
  topicId: string;
  band: MasteryBand;
  /** 0..1, null when band is insufficient_data. */
  score: number | null;
  confidence: Confidence;
  correctCount: number;
  totalCount: number;
  lastAnsweredAt: Date | null;
}

export interface FindingResult {
  topicId: string;
  tag: string;
  occurrences: number;
  windowSize: number;
  /** Response ids, newest first. */
  evidenceResponseIds: string[];
  /** Most recent answeredAt among the evidence — used for ranking. */
  lastOccurredAt: Date;
}

export interface TrendPointResult {
  /** YYYY-MM-DD (UTC). */
  date: string;
  accuracy: number;
  responseCount: number;
}

export interface TrendResult {
  direction: TrendDirection;
  points: TrendPointResult[];
}

// ─── Adaptation ──────────────────────────────────────────────────────────────

export interface PlanStepInput {
  id: string;
  kind: PlanStepKind;
  title: string;
  description: string;
  topicId: string | null;
  targetType: 'lesson' | 'practice_set' | 'page' | null;
  targetId: string | null;
  targetPage: number | null;
  estimatedMinutes: number;
  status: PlanStepStatus;
  orderIndex: number;
  insertedByAdaptation: boolean;
}

export interface ActiveFindingInput {
  id: string;
  topicId: string;
  tag: string;
  label: string;
  occurrences: number;
  windowSize: number;
  status: FindingStatus;
}

export interface AdaptationRecord {
  at: Date;
  reason: string;
  triggeredByFindingId: string;
  previousStepTitle: string;
  newStepTitle: string;
}

export interface AdaptationResult {
  /** The full step list after adaptation, re-indexed. Unchanged if `adapted` is false. */
  steps: PlanStepInput[];
  adapted: boolean;
  adaptation: AdaptationRecord | null;
}

/** Injected so the engine stays deterministic and free of side effects. */
export type IdFactory = (seed: string) => string;
