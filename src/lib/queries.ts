import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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

export function usePrimeConfig() {
  const [data, setData] = useState<PrimeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("prime_config").select("*").limit(1).maybeSingle();
    setData(data ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}
