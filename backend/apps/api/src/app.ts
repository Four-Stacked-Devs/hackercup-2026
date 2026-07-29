import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { API_BASE, DEVICE_ID_HEADER } from '@educlm/contracts';
import { env } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { createJobQueue } from './jobs/queue.js';
import { materialRoutes } from './routes/materials.js';
import { chatRoutes } from './routes/chat.js';
import { practiceRoutes } from './routes/practice.js';
import { progressRoutes } from './routes/progress.js';
import { planRoutes } from './routes/plan.js';
import { meRoutes } from './routes/me.js';
import { metaRoutes } from './routes/meta.js';
import { statusRoutes } from './routes/status.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(process.env['NODE_ENV'] !== 'production'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    // Uploads are streamed by @fastify/multipart, so the JSON limit stays small.
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  // Validate requests AND serialize responses with the published Zod schemas,
  // so a response that does not match its contract fails loudly here rather
  // than silently in the frontend.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    // @fastify/cors defaults to GET,HEAD,POST. That silently fails the
    // preflight for PATCH /me/preferences and every DELETE route — the browser
    // blocks the request before it is ever sent, so the server logs nothing.
    // List every method the API actually serves.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', DEVICE_ID_HEADER],
    exposedHeaders: ['Content-Type'],
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Limit per device rather than per IP: several students may share an IP.
    keyGenerator: (request) => {
      const header = request.headers[DEVICE_ID_HEADER];
      const deviceId = Array.isArray(header) ? header[0] : header;
      return deviceId ?? request.ip;
    },
  });

  registerErrorHandler(app);
  await registerAuth(app);

  const queue = createJobQueue(app.log);
  app.decorate('jobQueue', queue);

  // Outside the API_BASE prefix: this is the human-facing root, not a v1 route.
  await app.register(statusRoutes);

  await app.register(
    async (v1) => {
      await v1.register(materialRoutes(queue));
      await v1.register(chatRoutes);
      await v1.register(practiceRoutes);
      await v1.register(progressRoutes);
      await v1.register(planRoutes);
      await v1.register(meRoutes);
      await v1.register(metaRoutes);
    },
    { prefix: API_BASE },
  );

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    jobQueue: ReturnType<typeof createJobQueue>;
  }
}
