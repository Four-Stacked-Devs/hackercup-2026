import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiSuccess,
  createPracticeSetSchema,
  idParamSchema,
  practiceSetResultSchema,
  practiceSetSchema,
  questionFeedbackSchema,
  submitResponseSchema,
} from '@educlm/contracts';
import { ok } from '../lib/envelope.js';
import {
  completeSet,
  createPracticeSet,
  hydrateSet,
  recordResponse,
} from '../services/practice.js';

export const practiceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/practice/sets',
    {
      schema: {
        body: createPracticeSetSchema,
        response: { 200: apiSuccess(practiceSetSchema) },
      },
    },
    async (request) => {
      const { materialId, kind, topicId, count } = request.body;

      const set = await createPracticeSet({
        userId: request.user.id,
        materialId,
        kind,
        topicId,
        count,
        logger: request.log,
      });

      return ok(request, set);
    },
  );

  app.get(
    '/practice/sets/:id',
    {
      schema: {
        params: idParamSchema,
        response: { 200: apiSuccess(practiceSetSchema) },
      },
    },
    async (request) => ok(request, await hydrateSet(request.params.id, request.user.id)),
  );

  /** Answer checking happens here, server-side, against the stored answer. */
  app.post(
    '/practice/sets/:id/responses',
    {
      schema: {
        params: idParamSchema,
        body: submitResponseSchema,
        response: { 200: apiSuccess(questionFeedbackSchema) },
      },
    },
    async (request) => {
      const feedback = await recordResponse({
        userId: request.user.id,
        setId: request.params.id,
        questionId: request.body.questionId,
        selectedOptionId: request.body.selectedOptionId,
        timeSpentMs: request.body.timeSpentMs,
        now: new Date(),
      });

      return ok(request, feedback);
    },
  );

  app.post(
    '/practice/sets/:id/complete',
    {
      schema: {
        params: idParamSchema,
        response: { 200: apiSuccess(practiceSetResultSchema) },
      },
    },
    async (request) => {
      const result = await completeSet({
        userId: request.user.id,
        setId: request.params.id,
        now: new Date(),
      });

      return ok(request, result);
    },
  );
};
