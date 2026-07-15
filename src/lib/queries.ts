import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

export type Clone = Database["public"]["Tables"]["clones"]["Row"];
export type Module = Database["public"]["Tables"]["modules"]["Row"];
export type CloneModule = Database["public"]["Tables"]["clone_modules"]["Row"];
export type CascadeEvent = Database["public"]["Tables"]["cascade_events"]["Row"];
export type CascadeResult = Database["public"]["Tables"]["cascade_results"]["Row"];
export type PrimeConfig = Database["public"]["Tables"]["prime_config"]["Row"];

// These hooks are backed by TanStack Query (caching, dedup, retry, shared
// invalidation, real error surfacing) but intentionally keep the original
// `{ data, loading, refresh }` return shape so every existing call site keeps
// working unchanged. A new `error` field is exposed so screens can adopt error
// UI incrementally. `loading` reflects the first load only (isPending); manual
// `refresh()` now revalidates in the background without blanking the screen.

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

export function useClones() {
  const query = useQuery({
    queryKey: ["clones"],
    queryFn: async (): Promise<Clone[]> => {
      const { data, error } = await supabase
        .from("clones")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: query.data ?? [],
    loading: query.isPending,
    error: errorMessage(query.error),
    refresh,
  };
}

export function useModules() {
  const query = useQuery({
    queryKey: ["modules"],
    queryFn: async (): Promise<Module[]> => {
      const { data, error } = await supabase.from("modules").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: query.data ?? [],
    loading: query.isPending,
    error: errorMessage(query.error),
    refresh,
  };
}

export function useCascadeEvents(limit = 25) {
  const query = useQuery({
    queryKey: ["cascade_events", limit],
    queryFn: async (): Promise<CascadeEvent[]> => {
      const { data, error } = await supabase
        .from("cascade_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: query.data ?? [],
    loading: query.isPending,
    error: errorMessage(query.error),
    refresh,
  };
}

export type CloneModuleRow = {
  clone_id: string;
  module_id: string;
  module_name: string;
  module_slug: string;
};

export function useFleetModules() {
  const query = useQuery({
    queryKey: ["fleet_modules"],
    queryFn: async (): Promise<Record<string, CloneModuleRow[]>> => {
      const { data, error } = await supabase
        .from("clone_modules")
        .select("clone_id, module_id, modules(name, slug)");
      if (error) throw error;
      const map: Record<string, CloneModuleRow[]> = {};
      for (const row of (data ?? []) as Array<{
        clone_id: string;
        module_id: string;
        modules: { name: string; slug: string } | null;
      }>) {
        if (!row.modules) continue;
        (map[row.clone_id] ??= []).push({
          clone_id: row.clone_id,
          module_id: row.module_id,
          module_name: row.modules.name,
          module_slug: row.modules.slug,
        });
      }
      return map;
    },
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    byClone: query.data ?? {},
    loading: query.isPending,
    error: errorMessage(query.error),
    refresh,
  };
}

export function usePrimeConfig() {
  const { session, loading: authLoading } = useAuth();

  // RLS on prime_config requires `is_operator(auth.uid())`, so a pre-auth fetch
  // silently returns null. Gate on the session and key by user id so the query
  // re-runs when the user signs in (previously handled by a manual effect).
  const query = useQuery({
    queryKey: ["prime_config", session?.user?.id ?? null],
    enabled: !authLoading && !!session,
    queryFn: async (): Promise<PrimeConfig | null> => {
      const { data, error } = await supabase
        .from("prime_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("usePrimeConfig load failed:", error);
        throw error;
      }
      return data ?? null;
    },
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const loading = authLoading || (!!session && query.isPending);
  const data = session ? (query.data ?? null) : null;

  return { data, loading, error: errorMessage(query.error), refresh };
}
