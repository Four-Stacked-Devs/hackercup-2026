import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiSuccess,
  idParamSchema,
  learningPlanSchema,
  materialIdQuerySchema,
  revertAdaptationSchema,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { ok } from '../lib/envelope.js';
import { completeStep, getPlan, revertAdaptation, skipStep } from '../services/plan.js';

export const planRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/plan',
    {
      schema: {
        querystring: materialIdQuerySchema,
        response: { 200: apiSuccess(learningPlanSchema) },
      },
    },
    async (request) => {
      const material = await db().material.findFirst({
        where: { id: request.query.materialId, userId: request.user.id },
      });
      if (!material) throw errors.notFound('That material');

      return ok(request, await getPlan(request.user.id, material.id));
    },
  );

  app.post(
    '/plan/steps/:id/complete',
    {
      schema: { params: idParamSchema, response: { 200: apiSuccess(learningPlanSchema) } },
    },
    async (request) => {
      const plan = await completeStep(request.user.id, request.params.id);
      if (!plan) throw errors.notFound('That step');

      return ok(request, plan);
    },
  );

  app.post(
    '/plan/steps/:id/skip',
    {
      schema: { params: idParamSchema, response: { 200: apiSuccess(learningPlanSchema) } },
    },
    async (request) => {
      const plan = await skipStep(request.user.id, request.params.id);
      if (!plan) throw errors.notFound('That step');

      return ok(request, plan);
    },
  );

  /**
   * The student rejects an adaptation and returns to the original path.
   * Together with findings/:id/dismiss and steps/:id/skip, this is the
   * "preserve human control" principle in code — do not remove it.
   */
  app.post(
    '/plan/revert-adaptation',
    {
      schema: {
        body: revertAdaptationSchema,
        response: { 200: apiSuccess(learningPlanSchema) },
      },
    },
    async (request) => {
      const material = await db().material.findFirst({
        where: { id: request.body.materialId, userId: request.user.id },
      });
      if (!material) throw errors.notFound('That material');

      return ok(request, await revertAdaptation(request.user.id, material.id));
    },
  );
};
