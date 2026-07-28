import { API_ERROR_STATUS, type ApiErrorCode } from '@educlm/contracts';

/**
 * The only error type route handlers should throw.
 *
 * `message` is shown to the student verbatim, so it is written for a student:
 *   "This PDF is a scanned image, so there's no text to read."
 * not
 *   "pdfjs returned 0 text items."
 */
export class ApiException extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiException';
    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = details;
  }
}

export const errors = {
  notFound: (what = 'That') => new ApiException('NOT_FOUND', `${what} could not be found.`),

  unauthorized: () =>
    new ApiException(
      'UNAUTHORIZED',
      'This request is missing its device id, so we cannot tell whose work it belongs to.',
    ),

  validation: (message: string, details?: unknown) =>
    new ApiException('VALIDATION_ERROR', message, details),

  unsupportedFile: () =>
    new ApiException(
      'UNSUPPORTED_FILE',
      'That file is not a PDF. Upload a PDF of your module and we will take it from there.',
    ),

  noTextLayer: () =>
    new ApiException(
      'NO_TEXT_LAYER',
      "This PDF is a scanned image, so there's no text to read. Try a file where you can select the text with your cursor.",
    ),

  fileTooLarge: (maxBytes: number) =>
    new ApiException(
      'FILE_TOO_LARGE',
      `That file is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB. Try splitting the module into smaller parts.`,
    ),

  materialNotReady: () =>
    new ApiException(
      'MATERIAL_NOT_READY',
      'This material is still being prepared. Give it a few more seconds.',
    ),

  insufficientEvidence: (message?: string) =>
    new ApiException(
      'INSUFFICIENT_EVIDENCE',
      message ??
        'There are not enough answers yet to say anything reliable about this topic.',
    ),

  rateLimited: () =>
    new ApiException('RATE_LIMITED', 'That is a lot of requests at once. Give it a moment.'),

  llmUnavailable: (detail?: string) =>
    new ApiException(
      'LLM_UNAVAILABLE',
      'The tutor is temporarily unavailable. Your work is saved — try again in a moment.',
      detail,
    ),

  internal: (detail?: unknown) =>
    new ApiException(
      'INTERNAL_ERROR',
      'Something went wrong on our side. Your work is saved.',
      detail,
    ),
};
