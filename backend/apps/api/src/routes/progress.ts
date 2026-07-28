import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiSuccess,
  idParamSchema,
  materialIdQuerySchema,
  misconceptionFindingSchema,
  progressOverviewSchema,
  topicIdParamSchema,
  topicProgressSchema,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { ok } from '../lib/envelope.js';
import { toTopicMastery } from '../lib/serializers.js';
import {
  computeMasteryByTopic,
  computeTopicMastery,
  computeTrend,
} from '../modules/analytics/index.js';
import { loadResponseInputs, loadTopicResponseInputs } from '../services/analytics-data.js';
import { getFindingById, listFindings } from '../services/findings.js';
import { getPlan } from '../services/plan.js';

export const progressRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/progress/overview',
    {
      schema: {
        querystring: materialIdQuerySchema,
        response: { 200: apiSuccess(progressOverviewSchema) },
      },
    },
    async (request) => {
      const userId = request.user.id;
      const { materialId } = request.query;

      const material = await db().material.findFirst({ where: { id: materialId, userId } });
      if (!material) throw errors.notFound('That material');

      const topics = await db().topic.findMany({
        where: { materialId },
        orderBy: { orderIndex: 'asc' },
      });
      const topicNames = new Map(topics.map((t) => [t.id, t.name]));

      const responses = await loadResponseInputs(userId, materialId);

      const mastery = computeMasteryByTopic(
        topics.map((t) => t.id),
        responses,
      );

      const findings = await listFindings({ userId, materialId, responses });
      const plan = await getPlan(userId, materialId);
      const trend = computeTrend(responses);

      const practiceSetsCompleted = await db().practiceSet.count({
        where: { userId, materialId, status: 'COMPLETED' },
      });

      const correct = responses.filter((r) => r.isCorrect).length;

      return ok(request, {
        materialId,
        masteryByTopic: mastery.map((m) =>
          toTopicMastery(m, topicNames.get(m.topicId) ?? 'Unknown topic'),
        ),
        topFinding: findings[0] ?? null,
        plan,
        trend: {
          direction: trend.direction,
          points: trend.points,
        },
        totals: {
          responseCount: responses.length,
          practiceSetsCompleted,
          accuracy: responses.length === 0 ? null : correct / responses.length,
        },
      });
    },
  );

  app.get(
    '/progress/topics/:topicId',
    {
      schema: {
        params: topicIdParamSchema,
        response: { 200: apiSuccess(topicProgressSchema) },
      },
    },
    async (request) => {
      const userId = request.user.id;
      const { topicId } = request.params;

      const topic = await db().topic.findFirst({
        where: { id: topicId, material: { userId } },
      });
      if (!topic) throw errors.notFound('That topic');

      const responses = await loadTopicResponseInputs(userId, topicId);
      const mastery = computeTopicMastery(topicId, responses);

      const materialResponses = await loadResponseInputs(userId, topic.materialId);
      const findings = (
        await listFindings({ userId, materialId: topic.materialId, responses: materialResponses })
      ).filter((finding) => finding.topicId === topicId);

      const recentRows = await db().response.findMany({
        where: { userId, topicId },
        orderBy: { answeredAt: 'desc' },
        take: 10,
        include: { question: { include: { options: true } } },
      });

      return ok(request, {
        mastery: toTopicMastery(mastery, topic.name),
        findings,
        recentResponses: recentRows.map((row) => ({
          responseId: row.id,
          questionId: row.questionId,
          questionStem: row.question.stem,
          isCorrect: row.isCorrect,
          selectedOptionLabel:
            row.question.options.find((o) => o.id === row.selectedOptionId)?.label ?? '?',
          answeredAt: row.answeredAt.toISOString(),
        })),
      });
    },
  );

  app.get(
    '/progress/findings/:id',
    {
      schema: {
        params: idParamSchema,
        response: { 200: apiSuccess(misconceptionFindingSchema) },
      },
    },
    async (request) => {
      const finding = await getFindingById(request.user.id, request.params.id);
      if (!finding) throw errors.notFound('That finding');

      return ok(request, finding);
    },
  );

  /**
   * The student disagrees with a finding. Their judgement stands: a dismissed
   * finding is never re-raised and never triggers an adaptation.
   */
  app.post(
    '/progress/findings/:id/dismiss',
    {
      schema: {
        params: idParamSchema,
        response: { 200: apiSuccess(misconceptionFindingSchema) },
      },
    },
    async (request) => {
      const existing = await db().misconceptionFinding.findFirst({
        where: { id: request.params.id, userId: request.user.id },
      });
      if (!existing) throw errors.notFound('That finding');

      await db().misconceptionFinding.update({
        where: { id: existing.id },
        data: { status: 'DISMISSED' },
      });

      const updated = await getFindingById(request.user.id, existing.id);
      if (!updated) throw errors.notFound('That finding');

      return ok(request, updated);
    },
  );
};
