import {
  DEFAULT_PREFERENCES,
  accessibilityPreferencesSchema,
  type AccessibilityPreferences,
} from '@educlm/contracts';

/**
 * Reads stored preferences, falling back per field rather than all at once.
 *
 * Parsing the whole object and dropping it on any failure meant that adding one
 * preference to the schema — or storing one value the schema later stopped
 * accepting — silently reset every *other* setting the student had chosen. For
 * accessibility settings that is not a cosmetic reset: it takes away the text
 * size or contrast someone depends on, with nothing said about it.
 *
 * Each key is validated on its own, so only what is genuinely unreadable falls
 * back to the default.
 */
export function readPreferences(value: unknown): AccessibilityPreferences {
  const parsed = accessibilityPreferencesSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES;
  const stored = value as Record<string, unknown>;

  const kept: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  for (const [key, fieldSchema] of Object.entries(accessibilityPreferencesSchema.shape)) {
    const field = fieldSchema.safeParse(stored[key]);
    if (field.success) kept[key] = field.data;
  }

  const merged = accessibilityPreferencesSchema.safeParse(kept);
  return merged.success ? merged.data : DEFAULT_PREFERENCES;
}
