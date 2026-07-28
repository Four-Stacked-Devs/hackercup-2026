import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiSuccess,
  deletedResponseSchema,
  idParamSchema,
  lessonQuerySchema,
  lessonSchema,
  materialPageParamSchema,
  materialPageSchema,
  materialSchema,
  materialStatusResponseSchema,
  topicSchema,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import { ok } from '../lib/envelope.js';
import {
  toLesson,
  toMaterial,
  toMaterialStatus,
  toTopicMastery,
} from '../lib/serializers.js';
import { buildStorageKey, deleteFile, putFile, sha256 } from '../lib/storage.js';
import { computeTopicMastery } from '../modules/analytics/index.js';
import { loadResponseInputs } from '../services/analytics-data.js';
import { env } from '../env.js';
import type { JobQueue } from '../jobs/queue.js';

const PDF_MIME = 'application/pdf';

export function materialRoutes(queue: JobQueue): FastifyPluginAsyncZod {
  return async (app) => {
    /** Upload returns immediately; ingestion runs in the background. */
    app.post(
      '/materials',
      {
        schema: {
          response: { 202: apiSuccess(materialSchema) },
        },
      },
      async (request, reply) => {
        const file = await request.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES } });
        if (!file) throw errors.validation('No file was attached to that upload.');

        if (file.mimetype !== PDF_MIME) throw errors.unsupportedFile();

        const bytes = new Uint8Array(await file.toBuffer());
        if (bytes.byteLength === 0) throw errors.validation('That file is empty.');
        if (bytes.byteLength > env.MAX_UPLOAD_BYTES) {
          throw errors.fileTooLarge(env.MAX_UPLOAD_BYTES);
        }

        const titleField = file.fields['title'];
        const providedTitle =
          titleField && 'value' in titleField ? String(titleField.value) : undefined;

        const storageKey = buildStorageKey(request.user.id, file.filename);
        await putFile(storageKey, bytes);

        const material = await db().material.create({
          data: {
            userId: request.user.id,
            title: providedTitle?.trim() || stripExtension(file.filename),
            originalFilename: file.filename,
            mimeType: file.mimetype,
            sizeBytes: bytes.byteLength,
            storageKey,
            contentHash: sha256(bytes),
            status: 'PROCESSING',
            stage: 'EXTRACTING',
            stagePercent: 0,
          },
        });

        queue.enqueueIngestion(material.id);

        return reply.status(202).send(ok(request, toMaterial(material, 0)));
      },
    );

    app.get(
      '/materials',
      { schema: { response: { 200: apiSuccess(z.array(materialSchema)) } } },
      async (request) => {
        const rows = await db().material.findMany({
          where: { userId: request.user.id },
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { topics: true } } },
        });

        return ok(
          request,
          rows.map((row) => toMaterial(row, row._count.topics)),
        );
      },
    );

    app.get(
      '/materials/:id',
      {
        schema: {
          params: idParamSchema,
          response: { 200: apiSuccess(materialSchema) },
        },
      },
      async (request) => {
        const row = await db().material.findFirst({
          where: { id: request.params.id, userId: request.user.id },
          include: { _count: { select: { topics: true } } },
        });
        if (!row) throw errors.notFound('That material');

        return ok(request, toMaterial(row, row._count.topics));
      },
    );

    /** Polled every 1.5s while ingestion runs. */
    app.get(
      '/materials/:id/status',
      {
        schema: {
          params: idParamSchema,
          response: { 200: apiSuccess(materialStatusResponseSchema) },
        },
      },
      async (request) => {
        const row = await db().material.findFirst({
          where: { id: request.params.id, userId: request.user.id },
        });
        if (!row) throw errors.notFound('That material');

        return ok(request, toMaterialStatus(row));
      },
    );

    /** Hard delete: rows cascade and the stored file is removed. No soft delete. */
    app.delete(
      '/materials/:id',
      {
        schema: {
          params: idParamSchema,
          response: { 200: apiSuccess(deletedResponseSchema) },
        },
      },
      async (request) => {
        const row = await db().material.findFirst({
          where: { id: request.params.id, userId: request.user.id },
        });
        if (!row) throw errors.notFound('That material');

        await db().material.delete({ where: { id: row.id } });
        await deleteFile(row.storageKey);

        return ok(request, { deleted: true as const });
      },
    );

    app.get(
      '/materials/:id/topics',
      {
        schema: {
          params: idParamSchema,
          response: { 200: apiSuccess(z.array(topicSchema)) },
        },
      },
      async (request) => {
        const material = await db().material.findFirst({
          where: { id: request.params.id, userId: request.user.id },
        });
        if (!material) throw errors.notFound('That material');

        const topics = await db().topic.findMany({
          where: { materialId: material.id },
          orderBy: { orderIndex: 'asc' },
          include: { _count: { select: { questions: true } } },
        });

        const responses = await loadResponseInputs(request.user.id, material.id);

        return ok(
          request,
          topics.map((topic) => {
            const hasResponses = responses.some((r) => r.topicId === topic.id);
            const mastery = computeTopicMastery(topic.id, responses);

            return {
              id: topic.id,
              materialId: topic.materialId,
              name: topic.name,
              slug: topic.slug,
              summary: topic.summary,
              orderIndex: topic.orderIndex,
              sourcePages: topic.sourcePages,
              prerequisiteTopicIds: topic.prerequisiteTopicIds,
              questionCount: topic._count.questions,
              // null until any response exists — not a zeroed-out band.
              mastery: hasResponses ? toTopicMastery(mastery, topic.name) : null,
            };
          }),
        );
      },
    );

    app.get(
      '/materials/:id/lesson',
      {
        schema: {
          params: idParamSchema,
          querystring: lessonQuerySchema,
          response: { 200: apiSuccess(lessonSchema) },
        },
      },
      async (request) => {
        const material = await db().material.findFirst({
          where: { id: request.params.id, userId: request.user.id },
        });
        if (!material) throw errors.notFound('That material');
        if (material.status === 'PROCESSING') throw errors.materialNotReady();

        const topic = await db().topic.findFirst({
          where: { id: request.query.topicId, materialId: material.id },
        });
        if (!topic) throw errors.notFound('That topic');

        const sections = await db().lessonSection.findMany({
          where: { topicId: topic.id },
          orderBy: { orderIndex: 'asc' },
        });

        const generatedBy = sections[0]?.generatedBy ?? 'unknown';
        const generatedAt = sections[0]?.generatedAt ?? topic.createdAt;

        return ok(request, toLesson(topic, sections, generatedBy, generatedAt));
      },
    );

    /** The original page text, for side-by-side comparison with the lesson. */
    app.get(
      '/materials/:id/pages/:page',
      {
        schema: {
          params: materialPageParamSchema,
          response: { 200: apiSuccess(materialPageSchema) },
        },
      },
      async (request) => {
        const material = await db().material.findFirst({
          where: { id: request.params.id, userId: request.user.id },
        });
        if (!material) throw errors.notFound('That material');

        const page = await db().pageText.findUnique({
          where: {
            materialId_page: { materialId: material.id, page: request.params.page },
          },
        });
        if (!page) throw errors.notFound(`Page ${request.params.page}`);

        return ok(request, {
          page: page.page,
          text: page.text,
          // Page images are not rendered in the MVP (no OCR, no rasterising).
          imageUrl: null,
        });
      },
    );
  };
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || filename;
}
