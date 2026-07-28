import { z } from 'zod';
import { isoDateTime } from './primitives.js';

/**
 * Every response is wrapped. No bare arrays, no bare objects.
 */
export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR', // 400
  'UNAUTHORIZED', // 401
  'NOT_FOUND', // 404
  'UNSUPPORTED_FILE', // 415 — not a PDF
  'NO_TEXT_LAYER', // 422 — scanned image, no extractable text
  'FILE_TOO_LARGE', // 413
  'MATERIAL_NOT_READY', // 409 — still processing
  'INSUFFICIENT_EVIDENCE', // 409 — not enough responses to compute
  'RATE_LIMITED', // 429
  'LLM_UNAVAILABLE', // 503
  'INTERNAL_ERROR', // 500
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** HTTP status for each error code. Single source of truth for the handler. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  UNSUPPORTED_FILE: 415,
  NO_TEXT_LAYER: 422,
  FILE_TOO_LARGE: 413,
  MATERIAL_NOT_READY: 409,
  INSUFFICIENT_EVIDENCE: 409,
  RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export const apiMetaSchema = z.object({
  requestId: z.string(),
  generatedAt: isoDateTime,
});

export type ApiMeta = z.infer<typeof apiMetaSchema>;

/** Wraps a payload schema in the success envelope. */
export function apiSuccess<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    meta: apiMetaSchema.optional(),
  });
}

export type ApiSuccess<T> = { data: T; meta?: ApiMeta };

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    /** Safe to show the user verbatim. Written for a student, not a developer. */
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
