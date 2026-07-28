import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiMeta } from '@educlm/contracts';

/**
 * Every response is wrapped: `{ data, meta }` on success, `{ error }` on
 * failure. No bare arrays, no bare objects — the frontend can rely on one shape.
 */

export function buildMeta(request: FastifyRequest): ApiMeta {
  return { requestId: request.id, generatedAt: new Date().toISOString() };
}

export function ok<T>(request: FastifyRequest, data: T): { data: T; meta: ApiMeta } {
  return { data, meta: buildMeta(request) };
}

export function sendOk<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  data: T,
  status = 200,
): FastifyReply {
  return reply.status(status).send(ok(request, data));
}
