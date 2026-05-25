import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

const LEVEL: Record<AppRole, number> = {
  super_admin: 100,
  admin: 80,
  operator: 50,
  user: 10,
};

export function useUserRoles() {
  const { session, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      setRoles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      if (cancelled) return;
      setRoles((data ?? []).map((r) => r.role as AppRole));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, authLoading]);

  const max = roles.reduce((m, r) => Math.max(m, LEVEL[r] ?? 0), 0);
  return {
    roles,
    loading,
    isAdmin: max >= 80,
    isOperator: max >= 50,
  };
}
