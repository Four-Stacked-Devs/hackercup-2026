import { z } from 'zod';
import { apiErrorCodeSchema } from './envelope.js';
import {
  confidenceSchema,
  difficultySchema,
  findingStatusSchema,
  ingestionStageSchema,
  isoDateTime,
  masteryBandSchema,
  materialStatusSchema,
  optionLabelSchema,
  planStepKindSchema,
  planStepStatusSchema,
  practiceSetKindSchema,
  practiceSetStatusSchema,
  sectionKindSchema,
  trendDirectionSchema,
} from './primitives.js';

// ─── Citation ────────────────────────────────────────────────────────────────

export const citationSchema = z.object({
  chunkId: z.string(),
  page: z.number().int().positive(),
  sectionTitle: z.string().nullable(),
  /** <= 240 chars, verbatim from the source. */
  snippet: z.string().max(240),
});
export type Citation = z.infer<typeof citationSchema>;

// ─── Material ────────────────────────────────────────────────────────────────

export const materialProcessingSchema = z.object({
  stage: ingestionStageSchema,
  percent: z.number().int().min(0).max(100),
  message: z.string(),
});
export type MaterialProcessing = z.infer<typeof materialProcessingSchema>;

export const materialFailureSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
});
export type MaterialFailure = z.infer<typeof materialFailureSchema>;

export const materialSchema = z.object({
  id: z.string(),
  title: z.string(),
  originalFilename: z.string(),
  status: materialStatusSchema,
  pageCount: z.number().int().nullable(),
  topicCount: z.number().int(),
  processing: materialProcessingSchema.nullable(),
  failure: materialFailureSchema.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Material = z.infer<typeof materialSchema>;

/** Payload of GET /materials/:id/status — polled every 1.5s by the client. */
export const materialStatusResponseSchema = z.object({
  status: materialStatusSchema,
  processing: materialProcessingSchema.nullable(),
  failure: materialFailureSchema.nullable(),
});
export type MaterialStatusResponse = z.infer<typeof materialStatusResponseSchema>;

export const materialPageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
  imageUrl: z.string().nullable(),
});
export type MaterialPage = z.infer<typeof materialPageSchema>;

// ─── Mastery ─────────────────────────────────────────────────────────────────

export const topicMasterySchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  band: masteryBandSchema,
  /** 0..1, null when band is insufficient_data. */
  score: z.number().min(0).max(1).nullable(),
  confidence: confidenceSchema,
  correctCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  lastAnsweredAt: isoDateTime.nullable(),
});
export type TopicMastery = z.infer<typeof topicMasterySchema>;

// ─── Topic ───────────────────────────────────────────────────────────────────

export const topicSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  name: z.string(),
  slug: z.string(),
  summary: z.string(),
  orderIndex: z.number().int().min(0),
  sourcePages: z.array(z.number().int().positive()),
  prerequisiteTopicIds: z.array(z.string()),
  questionCount: z.number().int().min(0),
  /** null until any response exists. */
  mastery: topicMasterySchema.nullable(),
});
export type Topic = z.infer<typeof topicSchema>;

// ─── Lesson ──────────────────────────────────────────────────────────────────

export const lessonSectionSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  heading: z.string(),
  level: z.union([z.literal(2), z.literal(3)]),
  bodyMarkdown: z.string(),
  orderIndex: z.number().int().min(0),
  sourcePages: z.array(z.number().int().positive()),
  kind: sectionKindSchema,
  /** Frontend shows "Check this against the original". */
  needsReview: z.boolean(),
});
export type LessonSection = z.infer<typeof lessonSectionSchema>;

export const lessonSchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  readingTimeMinutes: z.number().int().min(0),
  sections: z.array(lessonSectionSchema),
  /** Model id — surfaced in the AI-usage label. */
  generatedBy: z.string(),
  generatedAt: isoDateTime,
});
export type Lesson = z.infer<typeof lessonSchema>;

// ─── Questions ───────────────────────────────────────────────────────────────

/** misconceptionTag is NEVER sent to the client. */
export const questionOptionSchema = z.object({
  id: z.string(),
  label: optionLabelSchema,
  text: z.string(),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

/** correctOptionId and explanation are NEVER sent before the student answers. */
export const questionSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  topicId: z.string(),
  topicName: z.string(),
  stem: z.string(),
  options: z.array(questionOptionSchema),
  difficulty: difficultySchema,
  sourcePage: z.number().int().positive(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionFeedbackSchema = z.object({
  questionId: z.string(),
  selectedOptionId: z.string(),
  correctOptionId: z.string(),
  isCorrect: z.boolean(),
  explanationMarkdown: z.string(),
  citation: citationSchema,
  misconception: z
    .object({
      tag: z.string(),
      label: z.string(),
      description: z.string(),
    })
    .nullable(),
  responseId: z.string(),
});
export type QuestionFeedback = z.infer<typeof questionFeedbackSchema>;

// ─── Practice ────────────────────────────────────────────────────────────────

export const practiceSetSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  kind: practiceSetKindSchema,
  status: practiceSetStatusSchema,
  reason: z.string().nullable(),
  questions: z.array(questionSchema),
  answeredCount: z.number().int().min(0),
  createdAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
});
export type PracticeSet = z.infer<typeof practiceSetSchema>;

// ─── Misconceptions ──────────────────────────────────────────────────────────

export const evidenceItemSchema = z.object({
  responseId: z.string(),
  questionId: z.string(),
  questionStem: z.string(),
  selectedOptionLabel: z.string(),
  selectedOptionText: z.string(),
  correctOptionText: z.string(),
  sourcePage: z.number().int().positive(),
  answeredAt: isoDateTime,
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const misconceptionFindingSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  topicName: z.string(),
  tag: z.string(),
  label: z.string(),
  description: z.string(),
  occurrences: z.number().int().min(0),
  windowSize: z.number().int().min(0),
  evidence: z.array(evidenceItemSchema),
  status: findingStatusSchema,
  detectedAt: isoDateTime,
});
export type MisconceptionFinding = z.infer<typeof misconceptionFindingSchema>;

export const practiceSetResultSchema = z.object({
  setId: z.string(),
  correctCount: z.number().int().min(0),
  total: z.number().int().min(0),
  byTopic: z.array(
    z.object({
      topicId: z.string(),
      topicName: z.string(),
      correct: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  ),
  newFindings: z.array(misconceptionFindingSchema),
  planUpdated: z.boolean(),
});
export type PracticeSetResult = z.infer<typeof practiceSetResultSchema>;

// ─── Plan ────────────────────────────────────────────────────────────────────

export const planStepTargetSchema = z.object({
  type: z.enum(['lesson', 'practice_set', 'page']),
  id: z.string().optional(),
  page: z.number().int().positive().optional(),
});
export type PlanStepTarget = z.infer<typeof planStepTargetSchema>;

export const planStepSchema = z.object({
  id: z.string(),
  kind: planStepKindSchema,
  title: z.string(),
  description: z.string(),
  topicId: z.string().nullable(),
  target: planStepTargetSchema.nullable(),
  estimatedMinutes: z.number().int().min(0),
  status: planStepStatusSchema,
  orderIndex: z.number().int().min(0),
  insertedByAdaptation: z.boolean(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const planAdaptationSchema = z.object({
  at: isoDateTime,
  reason: z.string(),
  triggeredByFindingId: z.string(),
  previousStepTitle: z.string(),
  newStepTitle: z.string(),
});
export type PlanAdaptation = z.infer<typeof planAdaptationSchema>;

export const learningPlanSchema = z.object({
  id: z.string(),
  materialId: z.string(),
  steps: z.array(planStepSchema),
  currentStepId: z.string().nullable(),
  lastAdaptation: planAdaptationSchema.nullable(),
});
export type LearningPlan = z.infer<typeof learningPlanSchema>;

// ─── Progress ────────────────────────────────────────────────────────────────

export const trendPointSchema = z.object({
  date: z.string(),
  accuracy: z.number().min(0).max(1),
  responseCount: z.number().int().min(0),
});
export type TrendPoint = z.infer<typeof trendPointSchema>;

export const progressOverviewSchema = z.object({
  materialId: z.string(),
  /** Ranked strongest → weakest. */
  masteryByTopic: z.array(topicMasterySchema),
  topFinding: misconceptionFindingSchema.nullable(),
  plan: learningPlanSchema,
  trend: z.object({
    direction: trendDirectionSchema,
    points: z.array(trendPointSchema),
  }),
  totals: z.object({
    responseCount: z.number().int().min(0),
    practiceSetsCompleted: z.number().int().min(0),
    accuracy: z.number().min(0).max(1).nullable(),
  }),
});
export type ProgressOverview = z.infer<typeof progressOverviewSchema>;

export const recentResponseSchema = z.object({
  responseId: z.string(),
  questionId: z.string(),
  questionStem: z.string(),
  isCorrect: z.boolean(),
  selectedOptionLabel: z.string(),
  answeredAt: isoDateTime,
});
export type RecentResponse = z.infer<typeof recentResponseSchema>;

export const topicProgressSchema = z.object({
  mastery: topicMasterySchema,
  findings: z.array(misconceptionFindingSchema),
  recentResponses: z.array(recentResponseSchema),
});
export type TopicProgress = z.infer<typeof topicProgressSchema>;

// ─── Preferences ─────────────────────────────────────────────────────────────

export const accessibilityPreferencesSchema = z.object({
  fontScale: z.union([z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(1.75)]),
  lineSpacing: z.enum(['normal', 'relaxed', 'loose']),
  highContrast: z.boolean(),
  /** Wider-spaced face for easier reading. */
  readableFont: z.boolean(),
  lowDataMode: z.boolean(),
  readAloud: z.object({
    enabled: z.boolean(),
    rate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)]),
  }),
  reducedMotion: z.boolean(),
});
export type AccessibilityPreferences = z.infer<typeof accessibilityPreferencesSchema>;

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  fontScale: 1,
  lineSpacing: 'normal',
  highContrast: false,
  readableFont: false,
  lowDataMode: false,
  readAloud: { enabled: false, rate: 1 },
  reducedMotion: false,
};

export const meSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  preferences: accessibilityPreferencesSchema,
});
export type Me = z.infer<typeof meSchema>;

// ─── Chat ────────────────────────────────────────────────────────────────────

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(citationSchema),
  createdAt: isoDateTime,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ─── AI disclosure ───────────────────────────────────────────────────────────

export const aiDisclosureSchema = z.object({
  models: z.array(
    z.object({
      purpose: z.string(),
      provider: z.string(),
      model: z.string(),
    }),
  ),
  libraries: z.array(
    z.object({
      name: z.string(),
      license: z.string(),
      url: z.string(),
    }),
  ),
});
export type AiDisclosure = z.infer<typeof aiDisclosureSchema>;
