import { z } from 'zod';

/**
 * ISO 8601 UTC timestamp.
 *
 * Deliberately a regex rather than zod's built-in datetime helper: the helper
 * moved namespaces between zod 3 and 4, and this package is the one thing both
 * the API and the frontend compile against. A regex is version-proof.
 */
export const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'must be an ISO 8601 timestamp',
  );

/**
 * Wire enums.
 *
 * These cross the wire as lowercase snake_case, NOT Prisma's SCREAMING_CASE.
 * The API maps between the two at the serialization boundary
 * (`apps/api/src/lib/serializers.ts`). Never leak a Prisma enum value.
 */
export const materialStatusSchema = z.enum(['uploaded', 'processing', 'ready', 'failed']);

export const ingestionStageSchema = z.enum([
  'extracting',
  'chunking',
  'extracting_topics',
  'embedding',
  'building_lessons',
  'done',
]);

export const difficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);

export const masteryBandSchema = z.enum([
  'insufficient_data',
  'needs_attention',
  'developing',
  'strong',
]);

export const confidenceSchema = z.enum(['none', 'low', 'medium', 'high']);

export const practiceSetKindSchema = z.enum(['diagnostic', 'focused', 'retry']);

/**
 * `generating`: the set exists but its questions are still being written; poll it.
 * `failed`: no question could be built from this material — offer a retry.
 */
export const practiceSetStatusSchema = z.enum([
  'generating',
  'failed',
  'in_progress',
  'completed',
  'abandoned',
]);

export const planStepKindSchema = z.enum(['read', 'practice', 'review', 'advance']);

export const planStepStatusSchema = z.enum(['pending', 'active', 'completed', 'skipped']);

export const sectionKindSchema = z.enum(['text', 'table', 'equation', 'figure_description']);

/**
 * Where a topic's lesson is. `draft` is the material's own text, reformatted
 * during ingestion so the topic is readable at once; `writing` and `ready` track
 * the AI study notes that replace it in the background. `failed` keeps the draft.
 */
export const lessonStatusSchema = z.enum(['draft', 'writing', 'ready', 'failed']);

export const findingStatusSchema = z.enum(['active', 'resolved', 'dismissed']);

export const trendDirectionSchema = z.enum([
  'improving',
  'flat',
  'declining',
  'insufficient_data',
]);

export const optionLabelSchema = z.enum(['A', 'B', 'C', 'D']);

export type MaterialStatus = z.infer<typeof materialStatusSchema>;
export type IngestionStage = z.infer<typeof ingestionStageSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type MasteryBand = z.infer<typeof masteryBandSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type PracticeSetKind = z.infer<typeof practiceSetKindSchema>;
export type PracticeSetStatus = z.infer<typeof practiceSetStatusSchema>;
export type PlanStepKind = z.infer<typeof planStepKindSchema>;
export type PlanStepStatus = z.infer<typeof planStepStatusSchema>;
export type SectionKind = z.infer<typeof sectionKindSchema>;
export type LessonStatus = z.infer<typeof lessonStatusSchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type TrendDirection = z.infer<typeof trendDirectionSchema>;
export type OptionLabel = z.infer<typeof optionLabelSchema>;
