import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Lock, Bot, Gauge, Activity } from "lucide-react";
import { useClones } from "@/lib/queries";
import { toast } from "sonner";

export const Route = createFileRoute("/cloudflare")({
  component: () => (
    <ProtectedRoute>
      <CloudflarePage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Cloudflare — Mission Control" }] }),
});

const CAPS = [
  { icon: Lock, label: "WAF rules", desc: "Block known attack patterns" },
  { icon: Bot, label: "Bot protection", desc: "Stop scrapers and credential stuffing" },
  { icon: Gauge, label: "Rate limiting", desc: "Throttle abusive clients" },
  { icon: Activity, label: "DDoS shield", desc: "Always-on layer 3-7 mitigation" },
];

function CloudflarePage() {
  const { data: clones } = useClones();
  const wrapped = clones.filter((c) => c.cloudflare_enabled);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-info/15 ring-1 ring-info/40">
          <Shield className="h-5 w-5 text-info" />
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            edge
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Cloudflare</h1>
          <p className="text-sm text-muted-foreground">
            On-demand edge protection per clone. API token requested only when first used.
          </p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        {CAPS.map((c) => (
          <Card key={c.label} className="bg-card">
            <CardContent className="p-5">
              <c.icon className="mb-3 h-5 w-5 text-info" />
              <div className="font-mono text-sm font-semibold">{c.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{c.desc}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wrapped clones ({wrapped.length})</CardTitle>
          <CardDescription>Clones currently running behind Cloudflare</CardDescription>
        </CardHeader>
        <CardContent>
          {wrapped.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No clones wrapped yet. Enable Cloudflare from a clone's detail page.
            </div>
          ) : (
            <ul className="space-y-2">
              {wrapped.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2"
                >
                  <span className="font-mono text-sm">{c.name}</span>
                  <Badge variant="outline" className="border-info/40 text-info">
                    <Shield className="mr-1 h-3 w-3" /> active
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API token</CardTitle>
          <CardDescription>
            We don't ask for credentials until you first apply a Cloudflare action. The token is
            stored as a server secret.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => toast.info("Token will be requested on first use")}>
            <Shield className="mr-2 h-4 w-4" /> Configure on first use
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
