import { buildApp } from './app.js';
import { closeDb, initDb } from './db/client.js';
import { describeMode, env, envFilesLoaded } from './env.js';

async function main(): Promise<void> {
  const app = await buildApp();

  await initDb(app.log);

  // Say which .env was read. A .env in the wrong directory is invisible
  // otherwise, because every setting is optional and the fallback just works.
  app.log.info(
    envFilesLoaded.length > 0
      ? `[boot] env loaded from ${envFilesLoaded.join(', ')}`
      : '[boot] no .env file found — using defaults',
  );
  app.log.info(`[boot] ${describeMode()}`);

  if (env.isFullyOffline) {
    app.log.info(
      '[boot] running with no external services: embedded database + deterministic stub model. ' +
        'Set DATABASE_URL and LLM_API_KEY in .env to use Supabase and Groq.',
    );
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    app.log.info(`[boot] ${signal} received, shutting down`);
    try {
      await app.close();
      await closeDb();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start EducLM API:', error);
  process.exit(1);
});
