import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '@educlm/contracts';
import { readPreferences } from '../../src/lib/preferences.js';

describe('readPreferences', () => {
  it('returns a valid stored object untouched', () => {
    const stored = {
      ...DEFAULT_PREFERENCES,
      fontScale: 1.5 as const,
      highContrast: true,
      readAloud: { enabled: true, rate: 1.25 as const },
    };

    expect(readPreferences(stored)).toEqual(stored);
  });

  it('keeps every readable setting when one is unreadable', () => {
    // The failure that matters: one bad value used to discard the whole object,
    // taking someone's text size and contrast with it.
    const stored = {
      ...DEFAULT_PREFERENCES,
      fontScale: 1.75,
      highContrast: true,
      lineSpacing: 'enormous',
    };

    const preferences = readPreferences(stored);

    expect(preferences.fontScale).toBe(1.75);
    expect(preferences.highContrast).toBe(true);
    expect(preferences.lineSpacing).toBe(DEFAULT_PREFERENCES.lineSpacing);
  });

  it('keeps the rest when a preference the schema knows about is missing', () => {
    // What adding a field to the schema looks like to already-stored rows.
    const { reducedMotion: _omitted, ...withoutOneField } = {
      ...DEFAULT_PREFERENCES,
      fontScale: 1.25 as const,
      readableFont: true,
    };

    const preferences = readPreferences(withoutOneField);

    expect(preferences.fontScale).toBe(1.25);
    expect(preferences.readableFont).toBe(true);
    expect(preferences.reducedMotion).toBe(DEFAULT_PREFERENCES.reducedMotion);
  });

  it('falls back entirely only when there is nothing to read', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('not an object')).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });
});
