import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

export type NotificationKind = Database["public"]["Enums"]["notification_kind"];
export type NotificationSeverity = Database["public"]["Enums"]["notification_severity"];
export type NotificationPreferences =
  Database["public"]["Tables"]["notification_preferences"]["Row"];

const STORAGE_KEY = "mc:notif-prefs:v1";

type LocalCache = {
  muted_kinds: NotificationKind[];
  muted_severities: NotificationSeverity[];
  mute_toasts: boolean;
  mute_browser_push: boolean;
  digest_mode: "realtime" | "hourly" | "daily";
};

const DEFAULTS: LocalCache = {
  muted_kinds: [],
  muted_severities: [],
  mute_toasts: false,
  mute_browser_push: false,
  digest_mode: "realtime",
};

function readCache(): LocalCache {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<LocalCache>;
    return {
      muted_kinds: parsed.muted_kinds ?? [],
      muted_severities: parsed.muted_severities ?? [],
      mute_toasts: parsed.mute_toasts ?? false,
      mute_browser_push: parsed.mute_browser_push ?? false,
      digest_mode: parsed.digest_mode ?? "realtime",
    };
  } catch {
    return DEFAULTS;
  }
}

function writeCache(p: LocalCache) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    // Notify other hook instances in the same tab
    window.dispatchEvent(new CustomEvent("mc:notif-prefs:change", { detail: p }));
  } catch {
    /* ignore */
  }
}

/**
 * Lightweight, sync-friendly accessor for the muted lists.
 * Reads from localStorage (kept in sync by useNotificationPreferences below)
 * so realtime subscribers can decide instantly whether to fire.
 */
export function getMutedSnapshot(): LocalCache {
  return readCache();
}

export function isMuted(
  snapshot: LocalCache,
  kind: NotificationKind,
  severity: NotificationSeverity,
): boolean {
  return (
    snapshot.muted_kinds.includes(kind) ||
    snapshot.muted_severities.includes(severity)
  );
}

/**
 * Full preference hook — keeps localStorage cache in sync with the database
 * so non-React code (browser push handler, realtime toasts) can read the
 * latest mutes synchronously without a round-trip.
 */
export function useNotificationPreferences() {
  const { session } = useAuth();
  const [prefs, setPrefs] = useState<LocalCache>(() => readCache());
  const [loading, setLoading] = useState(true);

  // Cross-instance sync within the same tab
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LocalCache>).detail;
      if (detail) setPrefs(detail);
    };
    window.addEventListener("mc:notif-prefs:change", handler);
    return () => window.removeEventListener("mc:notif-prefs:change", handler);
  }, []);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();
    const next: LocalCache = data
      ? {
          muted_kinds: data.muted_kinds ?? [],
          muted_severities: data.muted_severities ?? [],
          mute_toasts: data.mute_toasts,
          mute_browser_push: data.mute_browser_push,
          digest_mode: ((data as { digest_mode?: string }).digest_mode as LocalCache["digest_mode"]) ?? "realtime",
        }
      : DEFAULTS;
    setPrefs(next);
    writeCache(next);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (next: LocalCache) => {
      if (!session) return;
      // Optimistic
      setPrefs(next);
      writeCache(next);
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: session.user.id,
            muted_kinds: next.muted_kinds,
            muted_severities: next.muted_severities,
            mute_toasts: next.mute_toasts,
            mute_browser_push: next.mute_browser_push,
            digest_mode: next.digest_mode,
          },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    [session],
  );

  const toggleKind = useCallback(
    async (kind: NotificationKind) => {
      const set = new Set(prefs.muted_kinds);
      if (set.has(kind)) set.delete(kind);
      else set.add(kind);
      await save({ ...prefs, muted_kinds: Array.from(set) });
    },
    [prefs, save],
  );

  const toggleSeverity = useCallback(
    async (sev: NotificationSeverity) => {
      const set = new Set(prefs.muted_severities);
      if (set.has(sev)) set.delete(sev);
      else set.add(sev);
      await save({ ...prefs, muted_severities: Array.from(set) });
    },
    [prefs, save],
  );

  const setToggle = useCallback(
    async (key: "mute_toasts" | "mute_browser_push", value: boolean) => {
      await save({ ...prefs, [key]: value });
    },
    [prefs, save],
  );

  const setDigestMode = useCallback(
    async (mode: LocalCache["digest_mode"]) => {
      await save({ ...prefs, digest_mode: mode });
    },
    [prefs, save],
  );

  const muted = useMemo(
    () =>
      (kind: NotificationKind, severity: NotificationSeverity) =>
        isMuted(prefs, kind, severity),
    [prefs],
  );

  return {
    prefs,
    loading,
    refresh,
    save,
    toggleKind,
    toggleSeverity,
    setToggle,
    setDigestMode,
    muted,
  };
}
