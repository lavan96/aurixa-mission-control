import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { ProtectedRoute } from "@/components/protected-route";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { listPacks, applyTenantTopup, getTenant } from "@/lib/tokens.functions";

const SearchSchema = z.object({
  tenant: z.string().uuid().optional(),
});

export const Route = createFileRoute("/billing/topup")({
  component: TopupPage,
  validateSearch: (s) => SearchSchema.parse(s),
  head: () => ({ meta: [{ title: "Top up tokens — Mission Control" }] }),
});

function money(cents: number, ccy = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(cents / 100);
}

function TopupPage() {
  return (
    <ProtectedRoute>
      <TopupBody />
    </ProtectedRoute>
  );
}

function TopupBody() {
  const { tenant } = Route.useSearch();
  const qc = useQueryClient();

  const packsFn = useServerFn(listPacks);
  const tenantFn = useServerFn(getTenant);
  const topupFn = useServerFn(applyTenantTopup);

  const packs = useQuery({
    queryKey: ["topup", "packs"],
    queryFn: () => packsFn({}),
  });
  const tenantQ = useQuery({
    queryKey: ["topup", "tenant", tenant],
    queryFn: () => tenantFn({ data: { id: tenant! } }),
    enabled: !!tenant,
  });

  const active = (packs.data?.packs ?? []).filter((p) => p.is_active);

  async function buy(packId: string) {
    if (!tenant) {
      toast.error("No tenant in context — open this page from a clone deep-link.");
      return;
    }
    const r = await topupFn({ data: { tenantId: tenant, packId } });
    if ((r as { ok?: boolean }).ok === false) {
      toast.error(((r as { error?: string }).error) ?? "Top-up failed");
      return;
    }
    toast.success("Top-up applied");
    qc.invalidateQueries({ queryKey: ["topup", "tenant", tenant] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            credits
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Top up tokens</h2>
        </div>
        <Link
          to="/settings/billing"
          className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          full billing →
        </Link>
      </div>

      {tenant && tenantQ.data?.tenant && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Tenant: {tenantQ.data.tenant.display_name ?? tenantQ.data.tenant.external_ref}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Available" value={tenantQ.data.balance?.available ?? 0} />
            <Stat label="Reserved" value={tenantQ.data.balance?.reserved ?? 0} />
            <Stat label="Lifetime spent" value={tenantQ.data.balance?.lifetime_spent ?? 0} />
          </CardContent>
        </Card>
      )}

      {!tenant && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Open this page from a clone with <code>?tenant=&lt;tenant_id&gt;</code> in the URL to apply a
            top-up. Without a tenant, this page is read-only.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {active.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{p.name}</CardTitle>
                <Badge variant="secondary">{p.slug}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-3xl font-semibold tracking-tight">
                {p.tokens.toLocaleString()}{" "}
                <span className="text-sm font-normal text-muted-foreground">tokens</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {money(p.price_cents, p.currency)}
                {p.expires_after_days ? ` · expires in ${p.expires_after_days}d` : " · no expiry"}
              </p>
              <Button className="mt-auto" disabled={!tenant} onClick={() => buy(p.id)}>
                {tenant ? "Apply top-up" : "Select tenant"}
              </Button>
            </CardContent>
          </Card>
        ))}
        {active.length === 0 && !packs.isLoading && (
          <p className="text-sm text-muted-foreground">No active top-up packs configured.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
