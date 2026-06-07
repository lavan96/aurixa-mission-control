import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [hasRole, setHasRole] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      nav({ to: "/auth" });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      setHasRole((data?.length ?? 0) > 0);
    })();
  }, [session, loading, nav]);

  if (loading || hasRole === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="font-mono text-sm text-muted-foreground">authenticating…</div>
      </div>
    );
  }

  if (!session) return null;

  if (!hasRole) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h2 className="font-mono text-lg font-semibold">Access denied</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account has no operator role assigned. Ask an admin to grant access.
          </p>
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
