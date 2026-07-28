'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_PREFERENCES,
  type AccessibilityPreferences,
  type Me,
  type UpdatePreferencesRequest,
} from '@educlm/contracts';
import { getMe, updatePreferences } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/query-keys';

const LOCAL_KEY = 'educlm.preferences';

const LINE_HEIGHT: Record<AccessibilityPreferences['lineSpacing'], string> = {
  normal: '1.6',
  relaxed: '1.85',
  loose: '2.1',
};

interface PreferencesContextValue {
  preferences: AccessibilityPreferences;
  update: (patch: UpdatePreferencesRequest) => void;
  isSaving: boolean;
  saveError: string | null;
  displayName: string | null;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Read before the server answers, so the first paint is already correct. */
function readLocal(): AccessibilityPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw
      ? { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<AccessibilityPreferences>) }
      : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<AccessibilityPreferences>(DEFAULT_PREFERENCES);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setLocal(readLocal()), []);

  const me = useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => getMe(signal),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (me.data) setLocal(me.data.preferences);
  }, [me.data]);

  const mutation = useMutation({
    mutationFn: (patch: UpdatePreferencesRequest) => updatePreferences(patch),
    onSuccess: (saved) => {
      setLocal(saved);
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
      queryClient.setQueryData<Me>(queryKeys.me(), (current) =>
        current ? { ...current, preferences: saved } : current,
      );
      setSaveError(null);
    },
    onError: () => setSaveError("That preference didn't save. It still applies here."),
  });

  const update = useCallback(
    (patch: UpdatePreferencesRequest) => {
      // Applied instantly; the request only confirms it. A failed save leaves
      // the setting working for this session and says so.
      setLocal((current) => {
        const next: AccessibilityPreferences = {
          ...current,
          ...patch,
          readAloud: { ...current.readAloud, ...(patch.readAloud ?? {}) },
        };
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        return next;
      });
      mutation.mutate(patch);
    },
    [mutation],
  );

  // Every preference is a custom property or a data attribute on <html>, so a
  // change reflows the page without re-rendering the tree.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(local.fontScale));
    root.style.setProperty('--line-height-body', LINE_HEIGHT[local.lineSpacing]);
    root.dataset['contrast'] = local.highContrast ? 'high' : 'normal';
    root.dataset['readableFont'] = String(local.readableFont);
    root.dataset['reducedMotion'] = String(local.reducedMotion);
    root.dataset['lowData'] = String(local.lowDataMode);
  }, [local]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences: local,
      update,
      isSaving: mutation.isPending,
      saveError,
      displayName: me.data?.displayName ?? null,
    }),
    [local, update, mutation.isPending, saveError, me.data?.displayName],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
  return context;
}
