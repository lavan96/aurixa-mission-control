// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ProtectedRoute } from "@/components/protected-route";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Globe, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getPlatformHostingConfig,
  updatePlatformHostingConfig,
  reconcilePendingSubdomains,
  listCloneSubdomains,
} from "@/server/subdomain-hosting.functions";

export const Route = createFileRoute("/settings/domains")({
  component: () => (
    <ProtectedRoute requireRole="admin">
      <AppShell>
        <DomainsSettings />
      </AppShell>
    </ProtectedRoute>
  ),
  head: () => ({
    meta: [{ title: "Fleet domains — Aurixa Systems Mission Control" }],
  }),
});

function DomainsSettings() {
  const cfgFn = useServerFn(getPlatformHostingConfig);
  const listFn = useServerFn(listCloneSubdomains);
  const updateFn = useServerFn(updatePlatformHostingConfig);
  const reconcileFn = useServerFn(reconcilePendingSubdomains);

  const cfgQ = useQuery({ queryKey: ["platform-hosting-config"], queryFn: () => cfgFn() });
  const listQ = useQuery({ queryKey: ["clone-subdomains"], queryFn: () => listFn() });

  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    if (cfgQ.data?.config && !form) setForm({ ...cfgQ.data.config });
  }, [cfgQ.data, form]);

  if (cfgQ.isLoading || !form) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const ready = cfgQ.data?.ready;
  const tokenConfigured = cfgQ.data?.cloudflareTokenConfigured;

  const onSave = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          primary_domain: form.primary_domain,
          cloudflare_account_id: form.cloudflare_account_id || null,
          cloudflare_zone_id: form.cloudflare_zone_id || null,
          cloudflare_zone_name: form.cloudflare_zone_name || null,
          target_type: form.target_type,
          target_value: form.target_value,
          proxied: form.proxied,
          auto_provision: form.auto_provision,
        },
      });
      toast.success("Hosting configuration saved");
      cfgQ.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onReconcile = async () => {
    setReconciling(true);
    try {
      const r = await reconcileFn();
      if (r.ok) toast.success(`Enqueued ${r.enqueued} pending subdomain(s)`);
      else toast.error(r.error);
      listQ.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Reconcile failed");
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Globe className="h-6 w-6" /> Fleet domains
        </h1>
        <p className="text-sm text-muted-foreground">
          Every clone gets an optional <code className="rounded bg-muted px-1 text-xs">{`<slug>.${form.primary_domain}`}</code> subdomain, managed via Cloudflare DNS.
        </p>
      </div>

      {ready ? (
        <Alert className="border-emerald-500/40 bg-emerald-500/10">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <AlertTitle>Live</AlertTitle>
          <AlertDescription>
            Cloudflare token detected and zone <b>{form.cloudflare_zone_name || form.cloudflare_zone_id}</b> configured. New clones will auto-provision subdomains.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle>Dormant — awaiting Cloudflare</AlertTitle>
          <AlertDescription className="space-y-1">
            {!tokenConfigured && <div>• Cloudflare API token not configured (secret <code>CLOUDFLARE_API_TOKEN</code>).</div>}
            {!form.cloudflare_zone_id && <div>• Cloudflare zone ID not set below.</div>}
            <div className="text-xs opacity-80 pt-1">Pending clones are stamped <code>pending_platform</code> and will fan out automatically once both are set.</div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Platform configuration</CardTitle>
          <CardDescription>Applies to every subdomain we mint. Changes take effect on the next provisioning job.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Primary domain</Label>
              <Input value={form.primary_domain} onChange={(e) => setForm({ ...form, primary_domain: e.target.value })} />
              <p className="text-xs text-muted-foreground pt-1">Root apex — leave blank subdomains at the registrar so we can write child records.</p>
            </div>
            <div>
              <Label>Cloudflare zone ID</Label>
              <Input value={form.cloudflare_zone_id ?? ""} onChange={(e) => setForm({ ...form, cloudflare_zone_id: e.target.value })} placeholder="e.g. 3f8b…" />
            </div>
            <div>
              <Label>Cloudflare account ID</Label>
              <Input value={form.cloudflare_account_id ?? ""} onChange={(e) => setForm({ ...form, cloudflare_account_id: e.target.value })} />
            </div>
            <div>
              <Label>Zone name (display)</Label>
              <Input value={form.cloudflare_zone_name ?? ""} onChange={(e) => setForm({ ...form, cloudflare_zone_name: e.target.value })} placeholder={form.primary_domain} />
            </div>
            <div>
              <Label>Record type</Label>
              <select
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.target_type}
                onChange={(e) => setForm({ ...form, target_type: e.target.value })}
              >
                <option value="a">A (IP)</option>
                <option value="cname">CNAME (hostname)</option>
              </select>
            </div>
            <div>
              <Label>Target value</Label>
              <Input value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
              <p className="text-xs text-muted-foreground pt-1">Lovable default: <code>185.158.133.1</code> (A).</p>
            </div>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.proxied} onCheckedChange={(v) => setForm({ ...form, proxied: v })} />
              Cloudflare proxy (orange cloud)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.auto_provision} onCheckedChange={(v) => setForm({ ...form, auto_provision: v })} />
              Auto-provision subdomains on clone creation
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={onSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button variant="outline" onClick={onReconcile} disabled={!ready || reconciling}>
              {reconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Reconcile pending
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provisioned subdomains</CardTitle>
          <CardDescription>All clones with a subdomain intent recorded.</CardDescription>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (listQ.data?.rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No subdomains yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Clone</th>
                  <th>FQDN</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {listQ.data!.rows.map((r: any) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2">{r.name || r.slug}</td>
                    <td className="font-mono text-xs">{r.subdomain_fqdn}</td>
                    <td>
                      <Badge variant={r.subdomain_status === "active" ? "default" : "secondary"}>
                        {r.subdomain_status ?? "unknown"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
