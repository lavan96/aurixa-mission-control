import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

export type Clone = Database["public"]["Tables"]["clones"]["Row"];
export type Module = Database["public"]["Tables"]["modules"]["Row"];
export type CloneModule = Database["public"]["Tables"]["clone_modules"]["Row"];
export type CascadeEvent = Database["public"]["Tables"]["cascade_events"]["Row"];
export type CascadeResult = Database["public"]["Tables"]["cascade_results"]["Row"];
export type PrimeConfig = Database["public"]["Tables"]["prime_config"]["Row"];

export function useClones() {
  const [data, setData] = useState<Clone[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("clones")
      .select("*")
      .order("created_at", { ascending: false });
    setData(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

export function useModules() {
  const [data, setData] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("modules").select("*").order("name");
    setData(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

export function useCascadeEvents(limit = 25) {
  const [data, setData] = useState<CascadeEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("cascade_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    setData(data ?? []);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

export type CloneModuleRow = {
  clone_id: string;
  module_id: string;
  module_name: string;
  module_slug: string;
};

export function useFleetModules() {
  const [byClone, setByClone] = useState<Record<string, CloneModuleRow[]>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("clone_modules")
      .select("clone_id, module_id, modules(name, slug)");
    const map: Record<string, CloneModuleRow[]> = {};
    for (const row of (data ?? []) as Array<{
      clone_id: string;
      module_id: string;
      modules: { name: string; slug: string } | null;
    }>) {
      if (!row.modules) continue;
      const entry: CloneModuleRow = {
        clone_id: row.clone_id,
        module_id: row.module_id,
        module_name: row.modules.name,
        module_slug: row.modules.slug,
      };
      (map[row.clone_id] ??= []).push(entry);
    }
    setByClone(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { byClone, loading, refresh };
}

export function usePrimeConfig() {
  const { session, loading: authLoading } = useAuth();
  const [data, setData] = useState<PrimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("prime_config").select("*").limit(1).maybeSingle();
    if (error) {
      console.error("usePrimeConfig load failed:", error);
      setError(error.message);
    }
    setData(data ?? null);
    setLoading(false);
  }, []);

  // Re-fetch whenever the auth session changes (e.g. just signed in) — the
  // RLS policy on prime_config requires `is_operator(auth.uid())`, so a
  // pre-auth fetch silently returns null. Without this, the form stays empty
  // even after the user signs in.
  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      setData(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, session, authLoading]);

  return { data, loading, error, refresh };
}
