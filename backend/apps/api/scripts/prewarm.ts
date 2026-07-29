/**
 * Download and verify the local embedding model at BUILD time.
 *
 * Without this, the first request after every cold start pays for a model
 * download plus an onnxruntime session init. On a free-tier container at
 * 0.1 CPU that is minutes, not seconds, and the disk is ephemeral — so it is
 * paid again on every restart, not just the first deploy.
 *
 * Running it during the build puts the weights in the image, where the cost is
 * paid once per deploy instead.
 *
 * IMPORTANT: this must run with the same working directory as the start
 * command, because EMBEDDING_CACHE_DIR defaults to the relative './.models'.
 * Both use `pnpm --filter @educlm/api ...`, which sets cwd to apps/api.
 *
 * No-ops unless the local embedder is actually selected, so it is safe to leave
 * in the build command when EMBEDDING_PROVIDER is stub or openai.
 */
import { resolve } from 'node:path';
import { env, VECTOR_DIMS } from '../src/env.js';
import { getEmbedder } from '../src/lib/embeddings.js';

async function main(): Promise<void> {
  if (env.embeddingProvider !== 'local') {
    console.log(
      `[prewarm] EMBEDDING_PROVIDER=${env.embeddingProvider}, no local model to fetch — skipping.`,
    );
    return;
  }

  const cacheDir = resolve(env.EMBEDDING_CACHE_DIR);
  console.log(`[prewarm] model   ${env.EMBEDDING_MODEL} (${env.EMBEDDING_DTYPE})`);
  console.log(`[prewarm] cache   ${cacheDir}`);

  const startedAt = Date.now();
  const [vector] = await getEmbedder().embed(['warmup']);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  // A model that loads but emits the wrong width would fail later at the
  // pgvector insert, on a user's upload. Fail the build instead.
  if (!vector || vector.length !== VECTOR_DIMS) {
    throw new Error(
      `Prewarm produced ${vector?.length ?? 0} dimensions, expected ${VECTOR_DIMS}. ` +
        `EMBEDDING_MODEL and the vector(${VECTOR_DIMS}) column disagree.`,
    );
  }

  console.log(`[prewarm] ok — ${VECTOR_DIMS} dims in ${elapsed}s, weights cached.`);
}

main().catch((error) => {
  console.error('[prewarm] failed:', error);
  process.exit(1);
});
