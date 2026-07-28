import { DEVICE_ID_HEADER, apiErrorSchema, type ApiErrorCode } from '@educlm/contracts';
import type { ZodType } from 'zod';
import { API_ORIGIN } from '../config';
import { getDeviceId } from '../device';

/**
 * The one place `fetch` is allowed to appear (with chat-stream.ts, which needs
 * the raw response body). Everything above this file speaks in typed calls.
 */

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly details: unknown;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status: number;
    requestId?: string;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? 'unknown';
    this.details = init.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function requestHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(DEVICE_ID_HEADER, getDeviceId());
  return headers;
}

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Serialized as JSON, unless it is already FormData. */
  body?: unknown;
  /** The contract schema for the payload inside `data`. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const { method = 'GET', body, schema, signal } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers = requestHeaders();
  headers.set('Accept', 'application/json');
  if (body !== undefined && !isFormData) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    const init: RequestInit = { method, headers };
    if (signal) init.signal = signal;
    if (body !== undefined) init.body = isFormData ? body : JSON.stringify(body);

    response = await fetch(apiUrl(path), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: "EducLM couldn't reach the server. Check your connection and try again.",
      status: 0,
    });
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || (payload !== null && typeof payload === 'object' && 'error' in payload)) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        status: response.status,
        requestId: parsed.data.error.requestId,
        details: parsed.data.error.details,
      });
    }
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      status: response.status,
    });
  }

  const data = (payload as { data: unknown } | null)?.data;

  // Validating against the published schema means a contract drift shows up
  // here, named, instead of as an undefined read three components deep.
  if (schema) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        message: 'EducLM got an unexpected answer from the server.',
        status: response.status,
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  return data as T;
}
