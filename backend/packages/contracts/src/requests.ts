import { z } from 'zod';
import {
  accessibilityPreferencesSchema,
  chatMessageSchema,
  citationSchema,
} from './resources.js';
import { apiErrorCodeSchema } from './envelope.js';
import { practiceSetKindSchema } from './primitives.js';

// ─── Common params ───────────────────────────────────────────────────────────

export const idParamSchema = z.object({ id: z.string().min(1) });
export type IdParam = z.infer<typeof idParamSchema>;

export const topicIdParamSchema = z.object({ topicId: z.string().min(1) });

export const materialPageParamSchema = z.object({
  id: z.string().min(1),
  page: z.coerce.number().int().positive(),
});

export const materialIdQuerySchema = z.object({ materialId: z.string().min(1) });

// ─── Materials ───────────────────────────────────────────────────────────────

/**
 * POST /materials is multipart/form-data, so the body is not JSON-validated.
 * Fields: `file` (PDF, <= MAX_UPLOAD_BYTES) and optional `title`.
 */
export const createMaterialFieldsSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateMaterialFields = z.infer<typeof createMaterialFieldsSchema>;

export const lessonQuerySchema = z.object({ topicId: z.string().min(1) });

export const deletedResponseSchema = z.object({ deleted: z.literal(true) });

// ─── Chat ────────────────────────────────────────────────────────────────────

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  topicId: z.string().optional(),
  /** Defaults to true — SSE. Set false for a single JSON response. */
  stream: z.boolean().optional().default(true),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  /** ISO timestamp cursor — returns messages created before this. */
  before: z.string().optional(),
});

export const chatClearedResponseSchema = z.object({ cleared: z.literal(true) });

export const chatNonStreamResponseSchema = z.object({ message: chatMessageSchema });

/**
 * SSE event payloads for POST /materials/:id/chat.
 * Citations are emitted BEFORE `done` so the UI can render source chips
 * as the answer settles.
 */
export const sseTokenEventSchema = z.object({ text: z.string() });
export const sseCitationsEventSchema = z.object({ citations: z.array(citationSchema) });
export const sseDoneEventSchema = z.object({ message: chatMessageSchema });
export const sseErrorEventSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
});

export type SseTokenEvent = z.infer<typeof sseTokenEventSchema>;
export type SseCitationsEvent = z.infer<typeof sseCitationsEventSchema>;
export type SseDoneEvent = z.infer<typeof sseDoneEventSchema>;
export type SseErrorEvent = z.infer<typeof sseErrorEventSchema>;

export const SSE_EVENTS = ['token', 'citations', 'done', 'error'] as const;
export type SseEventName = (typeof SSE_EVENTS)[number];

// ─── Practice ────────────────────────────────────────────────────────────────

export const createPracticeSetSchema = z.object({
  materialId: z.string().min(1),
  kind: practiceSetKindSchema,
  topicId: z.string().optional(),
  count: z.number().int().min(1).max(20).optional().default(5),
});
export type CreatePracticeSetRequest = z.infer<typeof createPracticeSetSchema>;

export const submitResponseSchema = z.object({
  questionId: z.string().min(1),
  selectedOptionId: z.string().min(1),
  timeSpentMs: z.number().int().min(0),
});
export type SubmitResponseRequest = z.infer<typeof submitResponseSchema>;

// ─── Plan ────────────────────────────────────────────────────────────────────

export const revertAdaptationSchema = z.object({ materialId: z.string().min(1) });
export type RevertAdaptationRequest = z.infer<typeof revertAdaptationSchema>;

// ─── Preferences ─────────────────────────────────────────────────────────────

/** PATCH — every field optional, deep-merged onto the stored preferences. */
export const updatePreferencesSchema = accessibilityPreferencesSchema.partial().extend({
  readAloud: accessibilityPreferencesSchema.shape.readAloud.partial().optional(),
});
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesSchema>;
