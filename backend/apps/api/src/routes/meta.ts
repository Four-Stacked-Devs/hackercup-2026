import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { aiDisclosureSchema, apiSuccess } from '@educlm/contracts';
import { ok } from '../lib/envelope.js';
import { describeEmbeddings } from '../lib/embeddings.js';
import { describeLlm } from '../lib/llm.js';
import { env } from '../env.js';

/**
 * Served from the API rather than hardcoded in the frontend, so the disclosure
 * page can never drift from what the system actually runs. If you swap a model
 * via env vars, this endpoint changes with it.
 */
const LIBRARIES = [
  { name: 'Fastify', license: 'MIT', url: 'https://fastify.dev' },
  { name: 'Prisma', license: 'Apache-2.0', url: 'https://www.prisma.io' },
  { name: 'PostgreSQL + pgvector', license: 'PostgreSQL / MIT', url: 'https://github.com/pgvector/pgvector' },
  { name: 'PGlite', license: 'Apache-2.0', url: 'https://pglite.dev' },
  { name: 'Vercel AI SDK', license: 'Apache-2.0', url: 'https://sdk.vercel.ai' },
  { name: 'Transformers.js', license: 'Apache-2.0', url: 'https://huggingface.co/docs/transformers.js' },
  { name: 'BAAI/bge-small-en-v1.5', license: 'MIT', url: 'https://huggingface.co/BAAI/bge-small-en-v1.5' },
  { name: 'unpdf', license: 'MIT', url: 'https://github.com/unjs/unpdf' },
  { name: 'Zod', license: 'MIT', url: 'https://zod.dev' },
  { name: 'p-queue', license: 'MIT', url: 'https://github.com/sindresorhus/p-queue' },
];

const healthSchema = z.object({
  status: z.literal('ok'),
  mode: z.object({
    database: z.enum(['postgres', 'pglite']),
    llm: z.string(),
    embeddings: z.string(),
  }),
});

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/meta/ai-disclosure',
    { schema: { response: { 200: apiSuccess(aiDisclosureSchema) } } },
    async (request) =>
      ok(request, {
        models: [...describeLlm(), describeEmbeddings()],
        libraries: LIBRARIES,
      }),
  );

  app.get(
    '/meta/health',
    { schema: { response: { 200: apiSuccess(healthSchema) } } },
    async (request) =>
      ok(request, {
        status: 'ok' as const,
        mode: {
          database: env.dbMode,
          llm: env.llmProvider === 'stub' ? 'stub' : `${env.llmProvider}:${env.LLM_MODEL}`,
          embeddings: env.embeddingProvider,
        },
      }),
  );
};
