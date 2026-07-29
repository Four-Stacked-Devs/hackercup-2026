import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiSuccess,
  chatClearedResponseSchema,
  chatMessageSchema,
  chatMessagesQuerySchema,
  chatNonStreamResponseSchema,
  chatRequestSchema,
  idParamSchema,
  type Citation,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { ok } from '../lib/envelope.js';
import { createLlmClient } from '../lib/llm.js';
import { toChatMessage } from '../lib/serializers.js';
import { answerQuestion, streamAnswer } from '../modules/agent/chat.js';
import { retrieveChunks } from '../modules/agent/retrieval.js';

export const chatRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/materials/:id/chat',
    {
      schema: {
        params: idParamSchema,
        body: chatRequestSchema,
        // Streaming responses bypass serialization, so no response schema here.
      },
    },
    async (request, reply) => {
      const material = await db().material.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!material) throw errors.notFound('That material');
      if (material.status !== 'READY') throw errors.materialNotReady();

      const { message, topicId, stream } = request.body;
      const llm = createLlmClient(request.log);

      const chunks = await retrieveChunks({
        materialId: material.id,
        query: message,
        topicId,
      });

      await db().chatMessage.create({
        data: {
          userId: request.user.id,
          materialId: material.id,
          role: 'user',
          content: message,
          citations: [],
          topicId: topicId ?? null,
        },
      });

      const persist = async (content: string, citations: Citation[]) =>
        db().chatMessage.create({
          data: {
            userId: request.user.id,
            materialId: material.id,
            role: 'assistant',
            content,
            citations,
            topicId: topicId ?? null,
          },
        });

      // ── Non-streaming ────────────────────────────────────────────────────
      if (stream === false) {
        const result = await answerQuestion({ question: message, chunks, llm });

        if (result.refusedHomework) {
          request.log.info(
            { materialId: material.id },
            '[agent] declined to produce graded work',
          );
        }

        const row = await persist(result.text, result.citations);
        return reply.send(ok(request, { message: toChatMessage(row) }));
      }

      // ── SSE ──────────────────────────────────────────────────────────────
      // Writing to the raw socket bypasses Fastify's reply pipeline, which is
      // where @fastify/cors queued its headers — carry them over, or the
      // browser refuses to read the stream cross-origin.
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const generator = streamAnswer({ question: message, chunks, llm });

        let next = await generator.next();
        while (!next.done) {
          send('token', { text: next.value });
          next = await generator.next();
        }

        const { text, citations, refusedHomework } = next.value;

        if (refusedHomework) {
          request.log.info(
            { materialId: material.id },
            '[agent] declined to produce graded work',
          );
        }

        // Citations before `done`, so source chips render as the answer settles.
        send('citations', { citations });

        const row = await persist(text, citations);
        send('done', { message: toChatMessage(row) });
      } catch (error) {
        request.log.error({ err: error }, 'chat stream failed');
        send('error', {
          code: 'LLM_UNAVAILABLE',
          message: 'The tutor stopped mid-answer. Please ask again.',
        });
      } finally {
        reply.raw.end();
      }

      return reply;
    },
  );

  app.get(
    '/materials/:id/chat/messages',
    {
      schema: {
        params: idParamSchema,
        querystring: chatMessagesQuerySchema,
        response: { 200: apiSuccess(z.array(chatMessageSchema)) },
      },
    },
    async (request) => {
      const material = await db().material.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!material) throw errors.notFound('That material');

      const { limit, before } = request.query;
      const beforeDate = before ? new Date(before) : null;

      if (beforeDate && Number.isNaN(beforeDate.getTime())) {
        throw errors.validation('That "before" cursor is not a valid timestamp.');
      }

      const rows = await db().chatMessage.findMany({
        where: {
          materialId: material.id,
          userId: request.user.id,
          ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      // Newest-first for pagination, oldest-first for rendering.
      return ok(request, rows.reverse().map(toChatMessage));
    },
  );

  app.delete(
    '/materials/:id/chat',
    {
      schema: {
        params: idParamSchema,
        response: { 200: apiSuccess(chatClearedResponseSchema) },
      },
    },
    async (request) => {
      const material = await db().material.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!material) throw errors.notFound('That material');

      await db().chatMessage.deleteMany({
        where: { materialId: material.id, userId: request.user.id },
      });

      return ok(request, { cleared: true as const });
    },
  );
};

export const _chatNonStreamResponseSchema = chatNonStreamResponseSchema;
