import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  accessibilityPreferencesSchema,
  apiSuccess,
  meSchema,
  updatePreferencesSchema,
  DEFAULT_PREFERENCES,
  type AccessibilityPreferences,
} from '@educlm/contracts';
import { db } from '../db/client.js';
import { ok } from '../lib/envelope.js';

/** Unknown/legacy stored preferences fall back to the defaults, never to a crash. */
function readPreferences(value: unknown): AccessibilityPreferences {
  const parsed = accessibilityPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
}

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    { schema: { response: { 200: apiSuccess(meSchema) } } },
    async (request) =>
      ok(request, {
        userId: request.user.id,
        displayName: request.user.displayName,
        preferences: readPreferences(request.user.preferences),
      }),
  );

  app.patch(
    '/me/preferences',
    {
      schema: {
        body: updatePreferencesSchema,
        response: { 200: apiSuccess(accessibilityPreferencesSchema) },
      },
    },
    async (request) => {
      const current = readPreferences(request.user.preferences);
      const patch = request.body;

      const merged: AccessibilityPreferences = {
        ...current,
        ...patch,
        // readAloud is nested, so a shallow spread would drop a sibling field.
        readAloud: { ...current.readAloud, ...(patch.readAloud ?? {}) },
      };

      await db().user.update({
        where: { id: request.user.id },
        data: { preferences: merged },
      });

      return ok(request, merged);
    },
  );
};
