import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { env } from '../env.js';

/**
 * Local file storage for uploaded PDFs.
 *
 * Swap the implementation for S3 / Supabase Storage in deploy; the interface is
 * deliberately four functions wide.
 *
 * Section 11: uploaded documents are hard-deleted, never soft-deleted.
 */

const root = resolve(env.STORAGE_DIR);

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildStorageKey(userId: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]/g, '_').slice(-100);
  return join(userId, `${randomUUID()}_${safe}`);
}

export async function putFile(storageKey: string, bytes: Uint8Array): Promise<void> {
  const target = join(root, storageKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

export async function getFile(storageKey: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(root, storageKey)));
}

export function fileExists(storageKey: string): boolean {
  return existsSync(join(root, storageKey));
}

/** Hard delete. There is no soft delete anywhere in this system. */
export async function deleteFile(storageKey: string): Promise<void> {
  await rm(join(root, storageKey), { force: true });
}
