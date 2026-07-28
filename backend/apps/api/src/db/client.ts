import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../env.js';

/**
 * One Prisma client, two possible backends:
 *
 *   DATABASE_URL set   -> @prisma/adapter-pg  -> Supabase / any Postgres
 *   DATABASE_URL unset -> PGlite (embedded Postgres, WASM) + pgvector
 *
 * Both run the SAME schema and the SAME migration SQL, so there is exactly one
 * data path and no fixture layer to drift out of sync. PGlite exists purely so
 * `pnpm dev` works with zero configuration.
 */
let client: PrismaClient | null = null;

const MIGRATIONS_DIR = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

export interface DbLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const noopLogger: DbLogger = { info: () => {}, warn: () => {} };

async function createPgClient(): Promise<PrismaClient> {
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

async function createPgliteClient(logger: DbLogger): Promise<PrismaClient> {
  const [{ PGlite }, { vector }, { PrismaPGlite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite-pgvector'),
    import('pglite-prisma-adapter'),
  ]);

  // Persisted to disk so a restart keeps the student's work.
  const pglite = await PGlite.create({
    dataDir: env.PGLITE_DIR,
    extensions: { vector },
  });

  await applyMigrations(pglite, logger);

  const adapter = new PrismaPGlite(pglite);
  return new PrismaClient({ adapter });
}

/**
 * Apply `prisma/migrations/*​/migration.sql` in order.
 *
 * The Prisma CLI cannot reach an in-process PGlite instance, so migrations are
 * applied here instead. Applied names are recorded so restarts are idempotent.
 */
async function applyMigrations(
  pglite: { exec: (sql: string) => Promise<unknown>; query: <T>(sql: string) => Promise<{ rows: T[] }> },
  logger: DbLogger,
): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) {
    logger.warn(`[db] no migrations directory at ${MIGRATIONS_DIR}`);
    return;
  }

  await pglite.exec(
    `CREATE TABLE IF NOT EXISTS "_educlm_migrations" (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const applied = new Set(
    (await pglite.query<{ name: string }>(`SELECT name FROM "_educlm_migrations"`)).rows.map(
      (r) => r.name,
    ),
  );

  const pending = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((name) => !applied.has(name));

  for (const name of pending) {
    const sqlPath = join(MIGRATIONS_DIR, name, 'migration.sql');
    if (!existsSync(sqlPath)) continue;

    await pglite.exec(readFileSync(sqlPath, 'utf8'));
    await pglite.exec(
      `INSERT INTO "_educlm_migrations" (name) VALUES ('${name.replace(/'/g, "''")}')`,
    );
    logger.info(`[db] applied migration ${name}`);
  }

  if (pending.length === 0) logger.info('[db] schema up to date');
}

export async function initDb(logger: DbLogger = noopLogger): Promise<PrismaClient> {
  if (client) return client;

  client =
    env.dbMode === 'postgres' ? await createPgClient() : await createPgliteClient(logger);

  return client;
}

/** The active client. Throws if called before `initDb`. */
export function db(): PrismaClient {
  if (!client) {
    throw new Error('Database not initialised — call initDb() during boot.');
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}

export type { PrismaClient };
