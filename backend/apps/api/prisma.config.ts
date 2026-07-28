import { defineConfig } from 'prisma/config';
import { loadEnvFiles } from './src/lib/load-env.js';

// Same reason as src/env.ts: the Prisma CLI runs from apps/api, so plain
// `dotenv/config` would miss a .env at the monorepo root and migrations would
// fail with "no database URL" even though the user had filled one in.
loadEnvFiles();

/**
 * Prisma 7 moved CLI configuration out of package.json into this file.
 * `.env` is no longer auto-loaded at runtime either — hence the import above.
 *
 * Note: process.env is read directly rather than via prisma/config's `env()`
 * helper, because that helper THROWS on a missing variable. That would make
 * `prisma generate` fail on a fresh clone with no .env — which is exactly the
 * zero-config path this project promises. Commands that genuinely need a
 * connection (migrate, db push, studio) still fail, but with a clear message.
 */
const UNSET = 'postgresql://unset:unset@localhost:5432/unset?schema=public';

/** A key left blank in .env arrives as '', which `??` would not fall through. */
const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

// Migrations need the session-pooler / direct connection: Supabase's
// TRANSACTION pooler (port 6543) cannot execute DDL.
const url = read('DIRECT_URL') ?? read('DATABASE_URL') ?? UNSET;

if (url === UNSET) {
  console.warn(
    '[prisma] No DIRECT_URL or DATABASE_URL set.\n' +
      '         `prisma generate` works; migrate / db push / studio will not.\n' +
      '         The dev server does not need them — it falls back to embedded PGlite.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: { url },
});
