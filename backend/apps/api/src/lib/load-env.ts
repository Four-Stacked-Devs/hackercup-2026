import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/**
 * Load `.env` from the app directory OR any parent, up to the monorepo root.
 *
 * dotenv's default is `${process.cwd()}/.env`, which breaks in a monorepo: the
 * API runs from `apps/api`, so a `.env` sitting at the repo root — the obvious
 * place to put it, and where the README says to put it — is silently ignored.
 * Silently, because every value is optional: you get the zero-config fallback
 * and no error, which looks like "my key didn't work".
 *
 * Both locations are supported. The nearest file wins per key, because dotenv
 * does not overwrite a variable that is already set.
 */
export function loadEnvFiles(): string[] {
  const candidates: string[] = [];

  // src/lib -> src -> apps/api, then upward.
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(join(dir, '.env'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Also honour the working directory, for unusual launch setups.
  candidates.push(join(process.cwd(), '.env'));

  const found = [...new Set(candidates)].filter((path) => existsSync(path));
  if (found.length > 0) config({ path: found, quiet: true });

  return found;
}
