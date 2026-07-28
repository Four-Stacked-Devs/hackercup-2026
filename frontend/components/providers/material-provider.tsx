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
import type { Material } from '@educlm/contracts';
import { useMaterials } from '@/lib/hooks/use-materials';
import { DEMO_MATERIAL_ID } from '@/lib/config';

const STORAGE_KEY = 'educlm.material-id';

interface MaterialContextValue {
  materials: Material[];
  material: Material | null;
  materialId: string | null;
  setMaterialId: (id: string) => void;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const MaterialContext = createContext<MaterialContextValue | null>(null);

/**
 * The workspace always has one material in context — the wireframe's
 * "Context: JavaScript Fundamentals" control. The plan is single-material by
 * design, so this is a selection, not a collection.
 */
export function MaterialProvider({ children }: { children: ReactNode }) {
  const { data: materials, isLoading, error, refetch } = useMaterials();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(window.localStorage.getItem(STORAGE_KEY));
  }, []);

  const setMaterialId = useCallback((id: string) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    setSelected(id);
  }, []);

  const list = useMemo(() => materials ?? [], [materials]);

  const material = useMemo(() => {
    if (list.length === 0) return null;
    return (
      list.find((entry) => entry.id === selected) ??
      list.find((entry) => entry.id === DEMO_MATERIAL_ID) ??
      list.find((entry) => entry.status === 'ready') ??
      list[0] ??
      null
    );
  }, [list, selected]);

  const value = useMemo<MaterialContextValue>(
    () => ({
      materials: list,
      material,
      materialId: material?.id ?? null,
      setMaterialId,
      isLoading,
      error,
      refetch: () => void refetch(),
    }),
    [list, material, setMaterialId, isLoading, error, refetch],
  );

  return <MaterialContext.Provider value={value}>{children}</MaterialContext.Provider>;
}

export function useCurrentMaterial(): MaterialContextValue {
  const context = useContext(MaterialContext);
  if (!context) throw new Error('useCurrentMaterial must be used inside MaterialProvider');
  return context;
}
