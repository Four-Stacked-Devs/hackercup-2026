import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { API_ERROR_STATUS, type ApiErrorCode } from '@educlm/contracts';
import { ApiException } from '../lib/errors.js';

/**
 * One error shape for the whole API.
 *
 * `message` is always safe to show the student verbatim; developer detail goes
 * to the log and to `details`, never into the sentence the student reads.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND' satisfies ApiErrorCode,
        message: 'That endpoint does not exist.',
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    // 1. Our own, already student-safe.
    if (error instanceof ApiException) {
      if (error.status >= 500) request.log.error({ err: error }, error.message);
      else request.log.info({ code: error.code }, error.message);

      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          requestId: request.id,
        },
      });
    }

    // 2. Request failed schema validation.
    if (hasZodFastifySchemaValidationErrors(error) || error instanceof ZodError) {
      const details = hasZodFastifySchemaValidationErrors(error)
        ? error.validation
        : (error as ZodError).issues;

      return reply.status(API_ERROR_STATUS.VALIDATION_ERROR).send({
        error: {
          code: 'VALIDATION_ERROR' satisfies ApiErrorCode,
          message: "That request wasn't quite right. Please try again.",
          details,
          requestId: request.id,
        },
      });
    }

    // 3. Fastify's own errors worth translating.
    const fastifyError = error as { code?: string; statusCode?: number };

    if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(API_ERROR_STATUS.FILE_TOO_LARGE).send({
        error: {
          code: 'FILE_TOO_LARGE' satisfies ApiErrorCode,
          message: 'That file is too large. Try splitting the module into smaller parts.',
          requestId: request.id,
        },
      });
    }

    if (fastifyError.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED' satisfies ApiErrorCode,
          message: 'That is a lot of requests at once. Give it a moment.',
          requestId: request.id,
        },
      });
    }

    // 4. Anything else is a bug. Log it fully, tell the student nothing scary.
    request.log.error({ err: error }, 'unhandled error');

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR' satisfies ApiErrorCode,
        message: 'Something went wrong on our side. Your work is saved.',
        requestId: request.id,
      },
    });
  });
}
