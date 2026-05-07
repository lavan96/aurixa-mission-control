import { useCallback, useState } from "react";

export type SavedView<T> = {
  id: string;
  label: string;
  state: T;
};

const PREFIX = "aurixa:views:";

function load<T>(key: string): SavedView<T>[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as SavedView<T>[]) : [];
  } catch {
    return [];
  }
}

function persist<T>(key: string, views: SavedView<T>[]) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(views));
  } catch {
    /* ignore */
  }
}

/**
 * Generic saved-views hook backed by localStorage. Pass any serialisable state
 * shape and use the returned helpers to save/apply/remove named views.
 */
export function useSavedViews<T>(key: string) {
  const [views, setViews] = useState<SavedView<T>[]>(() => load<T>(key));

  const save = useCallback(
    (label: string, state: T) => {
      const trimmed = label.trim();
      if (!trimmed) return { ok: false as const, error: "Name required" };
      if (views.some((v) => v.label === trimmed))
        return { ok: false as const, error: "Name already used" };
      const next = [...views, { id: crypto.randomUUID(), label: trimmed, state }];
      setViews(next);
      persist(key, next);
      return { ok: true as const };
    },
    [key, views],
  );

  const remove = useCallback(
    (id: string) => {
      const next = views.filter((v) => v.id !== id);
      setViews(next);
      persist(key, next);
    },
    [key, views],
  );

  return { views, save, remove };
}
