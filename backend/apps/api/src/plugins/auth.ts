import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEVICE_ID_HEADER, DEFAULT_PREFERENCES } from '@educlm/contracts';
import { db } from '../db/client.js';
import { errors } from '../lib/errors.js';
import type { User } from '../generated/prisma/client.js';

/**
 * Device-scoped anonymous sessions.
 *
 * No passwords, no email. The client generates a stable id, sends it as
 * `X-Device-Id`, and this hook upserts the matching User row. Every query
 * downstream is scoped by `userId`: there is no public read path anywhere in
 * this API, and nothing is ever shared or ranked.
 */

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

/** Routes that legitimately have no user (health, AI disclosure). */
const PUBLIC_PREFIXES = ['/api/v1/meta'];

/**
 * Matched exactly, never as a prefix. '/' is a prefix of every URL in the API,
 * so adding it to PUBLIC_PREFIXES would silently make the entire surface
 * unauthenticated. Keep the two lists separate for that reason alone.
 */
const PUBLIC_PATHS = ['/'];

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  // Deliberately not `decorateRequest`: Fastify 5 warns against decorating with
  // a mutable reference type. The hook assigns it per request instead.
  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (isPublic(request.url)) return;

    const header = request.headers[DEVICE_ID_HEADER];
    const deviceId = Array.isArray(header) ? header[0] : header;

    if (!deviceId || deviceId.trim().length === 0) {
      throw errors.unauthorized();
    }

    if (deviceId.length > 200) {
      throw errors.validation('That device id is not valid.');
    }

    request.user = await db().user.upsert({
      where: { deviceId },
      update: {},
      create: { deviceId, preferences: DEFAULT_PREFERENCES },
    });
  });
}
