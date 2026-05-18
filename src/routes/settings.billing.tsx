import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, RotateCw, Trash2 } from "lucide-react";
import {
  listPlans, upsertPlan,
  listPacks, upsertPack,
  listRates, upsertRate,
  listTenants, getTenant,
  assignTenantPlan, grantTenantTokens, applyTenantTopup, refundReportJob,
  getTokenUsageSummary,
} from "@/lib/tokens.functions";
import {
  listCloneApiKeys, createCloneApiKey, revokeCloneApiKey, rotateCloneApiKey,
} from "@/lib/clone-api-keys.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings/billing")({
  component: BillingDashboard,
  head: () => ({ meta: [{ title: "Billing & Tokens — Mission Control" }] }),
});

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

function money(cents: number, ccy = "USD"): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(cents / 100);
}

function BillingDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">monetization</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Billing &amp; Tokens</h2>
        </div>
        <Link to="/settings" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">← back</Link>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tenants">Tenants</TabsTrigger>
          <TabsTrigger value="plans">Plans &amp; Packs</TabsTrigger>
          <TabsTrigger value="rates">Rates</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="tenants"><TenantsTab /></TabsContent>
        <TabsContent value="plans"><PlansPacksTab /></TabsContent>
        <TabsContent value="rates"><RatesTab /></TabsContent>
        <TabsContent value="keys"><KeysTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab() {
  const fn = useServerFn(getTokenUsageSummary);
  const { data, isLoading } = useQuery({ queryKey: ["token-usage-summary"], queryFn: () => fn() });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Stat label="Tenants" value={fmt(data.totalTenants)} />
      <Stat label="Available (fleet)" value={fmt(data.totalAvailable)} />
      <Stat label="Spent 30d" value={fmt(data.totalSpent30d)} />
      <Stat label="Jobs 30d" value={fmt(data.jobCount30d)} />
      <Card className="md:col-span-2">
        <CardHeader><CardTitle className="text-sm">Top report kinds (30d)</CardTitle></CardHeader>
        <CardContent>
          {data.topKinds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.topKinds.map((k) => (
                <li key={k.kind} className="flex justify-between">
                  <span className="font-mono">{k.kind}</span>
                  <span>{fmt(k.tokens)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader><CardTitle className="text-sm">Daily spend (30d)</CardTitle></CardHeader>
        <CardContent>
          <Sparkline series={data.series.map((s) => s.tokens)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length === 0) return <p className="text-sm text-muted-foreground">No data.</p>;
  const max = Math.max(1, ...series);
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {series.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${(v / max) * 100}%` }} />
      ))}
    </div>
  );
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

function TenantsTab() {
  const listFn = useServerFn(listTenants);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tenants", search],
    queryFn: () => listFn({ data: { search: search || undefined } }),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Search by name or external_ref…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="outline" size="icon" onClick={() => refetch()}><RotateCw className="h-4 w-4" /></Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            {data?.tenants.map((t: any) => {
              const bal = Array.isArray(t.token_balances) ? t.token_balances[0] : t.token_balances;
              const plan = Array.isArray(t.billing_plans) ? t.billing_plans[0] : t.billing_plans;
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t.id)}>
                  <TableCell>
                    <div className="font-medium">{t.display_name || t.external_ref}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{t.external_ref}</div>
                  </TableCell>
                  <TableCell>{plan?.name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(bal?.available)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(bal?.reserved)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(bal?.lifetime_spent)}</TableCell>
                  <TableCell><Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge></TableCell>
                </TableRow>
              );
            })}
            {data && data.tenants.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No tenants yet. They auto-provision on first meter call from a clone.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="w-full max-w-xl overflow-y-auto sm:max-w-xl">
          {selected && <TenantDetail id={selected} onClose={() => setSelected(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TenantDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const fn = useServerFn(getTenant);
  const assignFn = useServerFn(assignTenantPlan);
  const grantFn = useServerFn(grantTenantTokens);
  const topupFn = useServerFn(applyTenantTopup);
  const refundFn = useServerFn(refundReportJob);
  const plansFn = useServerFn(listPlans);
  const packsFn = useServerFn(listPacks);
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ["tenant", id], queryFn: () => fn({ data: { id } }) });
  const { data: plansData } = useQuery({ queryKey: ["plans"], queryFn: () => plansFn() });
  const { data: packsData } = useQuery({ queryKey: ["packs"], queryFn: () => packsFn() });

  const [planId, setPlanId] = useState("");
  const [packId, setPackId] = useState("");
  const [grantAmt, setGrantAmt] = useState("");
  const [grantReason, setGrantReason] = useState("Manual operator grant");

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["tenants"] }); };

  if (!data?.tenant) return <p className="p-4 text-sm">Not found.</p>;
  const t = data.tenant as any;
  const plan = t.billing_plans;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{t.display_name || t.external_ref}</SheetTitle>
        <p className="font-mono text-[11px] text-muted-foreground">{t.external_ref} · clone {t.clones?.name ?? "—"}</p>
      </SheetHeader>
      <div className="mt-4 space-y-4">
        <Card>
          <CardContent className="grid grid-cols-3 gap-3 pt-4 text-sm">
            <div><p className="text-[10px] uppercase text-muted-foreground">Available</p><p className="text-lg font-semibold">{fmt(data.balance?.available)}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Reserved</p><p className="text-lg font-semibold">{fmt(data.balance?.reserved)}</p></div>
            <div><p className="text-[10px] uppercase text-muted-foreground">Spent</p><p className="text-lg font-semibold">{fmt(data.balance?.lifetime_spent)}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Plan</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">Current: <span className="font-mono">{plan?.name ?? "none"}</span></p>
            <div className="flex gap-2">
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Assign plan…" /></SelectTrigger>
                <SelectContent>
                  {plansData?.plans.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · {fmt(p.monthly_allowance)}/mo</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={!planId} onClick={async () => {
                const r = await assignFn({ data: { tenantId: id, planId } });
                if (r.ok) { toast.success("Plan assigned"); refresh(); } else toast.error(r.error);
              }}>Assign</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Grant tokens</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input type="number" placeholder="Tokens" value={grantAmt} onChange={(e) => setGrantAmt(e.target.value)} />
            <Input placeholder="Reason" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} />
            <Button onClick={async () => {
              const n = parseInt(grantAmt, 10);
              if (!n || n <= 0) return toast.error("Invalid amount");
              const r = await grantFn({ data: { tenantId: id, tokens: n, reason: grantReason } });
              if (r.ok) { toast.success(`Granted ${fmt(n)} tokens`); setGrantAmt(""); refresh(); } else toast.error(r.error ?? "Failed");
            }}>Grant</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Apply top-up pack</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Select value={packId} onValueChange={setPackId}>
              <SelectTrigger><SelectValue placeholder="Pick pack…" /></SelectTrigger>
              <SelectContent>
                {packsData?.packs.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · +{fmt(p.tokens)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!packId} onClick={async () => {
              const r = await topupFn({ data: { tenantId: id, packId } });
              if (r.ok) { toast.success(`Top-up applied (+${fmt(r.tokens ?? 0)})`); refresh(); } else toast.error(r.error ?? "Failed");
            }}>Apply</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Recent jobs</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.jobs.length === 0 && <p className="text-muted-foreground">No jobs yet.</p>}
            {data.jobs.slice(0, 15).map((j: any) => (
              <div key={j.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{j.kind}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(j.started_at).toLocaleString()} · {j.status}</div>
                </div>
                <div className="text-right tabular-nums">{fmt(j.charged_tokens ?? j.estimated_tokens)}</div>
                {j.status === "completed" && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    const r = await refundFn({ data: { jobId: j.id, reason: "Operator refund" } });
                    if (r.ok) { toast.success(`Refunded ${fmt(r.refunded_tokens ?? 0)}`); refresh(); } else toast.error(r.error ?? "Failed");
                  }}>Refund</Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Button variant="ghost" onClick={onClose} className="w-full">Close</Button>
      </div>
    </>
  );
}

// ─── Plans & Packs ───────────────────────────────────────────────────────────

function PlansPacksTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PlansCard />
      <PacksCard />
    </div>
  );
}

function PlansCard() {
  const listFn = useServerFn(listPlans);
  const upsertFn = useServerFn(upsertPlan);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["plans"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const startNew = () => { setDraft({ slug: "", name: "", monthly_allowance: 0, rollover_cap: 0, overage_policy: "block", price_cents: 0, currency: "USD", is_active: true }); setOpen(true); };
  const edit = (p: any) => { setDraft({ ...p }); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-sm">Billing plans</CardTitle>
        <Button size="sm" onClick={startNew}><Plus className="mr-1 h-3 w-3" />New</Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data?.plans.map((p: any) => (
          <button key={p.id} onClick={() => edit(p)} className="flex w-full items-center justify-between rounded border border-border p-2 text-left hover:bg-muted/30">
            <div>
              <div className="font-medium">{p.name} <span className="font-mono text-[10px] text-muted-foreground">/{p.slug}</span></div>
              <div className="text-xs text-muted-foreground">{fmt(p.monthly_allowance)} tokens/mo · {p.overage_policy}</div>
            </div>
            <div className="text-right tabular-nums">{money(p.price_cents, p.currency)}<div className="text-[10px] text-muted-foreground">{p.is_active ? "active" : "inactive"}</div></div>
          </button>
        ))}
        {!data?.plans.length && <p className="text-muted-foreground">No plans.</p>}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{draft?.id ? "Edit plan" : "New plan"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-2 text-sm">
              <Input placeholder="Slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
              <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input type="number" placeholder="Monthly allowance" value={draft.monthly_allowance} onChange={(e) => setDraft({ ...draft, monthly_allowance: parseInt(e.target.value || "0", 10) })} />
              <Input type="number" placeholder="Rollover cap" value={draft.rollover_cap} onChange={(e) => setDraft({ ...draft, rollover_cap: parseInt(e.target.value || "0", 10) })} />
              <Select value={draft.overage_policy} onValueChange={(v) => setDraft({ ...draft, overage_policy: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">block</SelectItem>
                  <SelectItem value="topup_only">topup_only</SelectItem>
                  <SelectItem value="pay_as_you_go">pay_as_you_go</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" placeholder="Price (cents)" value={draft.price_cents} onChange={(e) => setDraft({ ...draft, price_cents: parseInt(e.target.value || "0", 10) })} />
              <Input placeholder="Currency" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} maxLength={3} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={async () => {
              const r = await upsertFn({ data: draft });
              if (r.ok) { toast.success("Saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["plans"] }); } else toast.error(r.error);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PacksCard() {
  const listFn = useServerFn(listPacks);
  const upsertFn = useServerFn(upsertPack);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["packs"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const startNew = () => { setDraft({ slug: "", name: "", tokens: 1000, price_cents: 0, currency: "USD", is_active: true }); setOpen(true); };
  const edit = (p: any) => { setDraft({ ...p }); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-sm">Top-up packs</CardTitle>
        <Button size="sm" onClick={startNew}><Plus className="mr-1 h-3 w-3" />New</Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data?.packs.map((p: any) => (
          <button key={p.id} onClick={() => edit(p)} className="flex w-full items-center justify-between rounded border border-border p-2 text-left hover:bg-muted/30">
            <div>
              <div className="font-medium">{p.name} <span className="font-mono text-[10px] text-muted-foreground">/{p.slug}</span></div>
              <div className="text-xs text-muted-foreground">+{fmt(p.tokens)} tokens</div>
            </div>
            <div className="text-right tabular-nums">{money(p.price_cents, p.currency)}</div>
          </button>
        ))}
        {!data?.packs.length && <p className="text-muted-foreground">No packs.</p>}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{draft?.id ? "Edit pack" : "New pack"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-2 text-sm">
              <Input placeholder="Slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
              <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input type="number" placeholder="Tokens" value={draft.tokens} onChange={(e) => setDraft({ ...draft, tokens: parseInt(e.target.value || "0", 10) })} />
              <Input type="number" placeholder="Price (cents)" value={draft.price_cents} onChange={(e) => setDraft({ ...draft, price_cents: parseInt(e.target.value || "0", 10) })} />
              <Input placeholder="Currency" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} maxLength={3} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={async () => {
              const r = await upsertFn({ data: draft });
              if (r.ok) { toast.success("Saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["packs"] }); } else toast.error(r.error);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Rates ───────────────────────────────────────────────────────────────────

function RatesTab() {
  const listFn = useServerFn(listRates);
  const upsertFn = useServerFn(upsertRate);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["rates"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const startNew = () => { setDraft({ kind: "", base_cost: 0, per_unit: {}, notes: "" }); setOpen(true); };
  const edit = (r: any) => { setDraft({ ...r, per_unit_json: JSON.stringify(r.per_unit ?? {}, null, 2) }); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-sm">Token rate cards</CardTitle>
        <Button size="sm" onClick={startNew}><Plus className="mr-1 h-3 w-3" />New rate</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead className="text-right">Base</TableHead><TableHead>Per-unit</TableHead><TableHead>Effective</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.rates.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.kind}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.base_cost)}</TableCell>
                <TableCell className="font-mono text-xs">{JSON.stringify(r.per_unit)}</TableCell>
                <TableCell className="text-xs">{new Date(r.effective_from).toLocaleDateString()}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => edit(r)}>Edit</Button></TableCell>
              </TableRow>
            ))}
            {!data?.rates.length && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No rates configured.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{draft?.id ? "Edit rate" : "New rate"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="grid gap-2 text-sm">
              <Input placeholder="Kind (e.g. report.financial)" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} />
              <Input type="number" placeholder="Base cost" value={draft.base_cost} onChange={(e) => setDraft({ ...draft, base_cost: parseInt(e.target.value || "0", 10) })} />
              <textarea
                className="min-h-[100px] rounded border border-border bg-background p-2 font-mono text-xs"
                placeholder='Per-unit JSON, e.g. {"page": 5, "ai_token": 0.01}'
                value={draft.per_unit_json ?? JSON.stringify(draft.per_unit ?? {})}
                onChange={(e) => setDraft({ ...draft, per_unit_json: e.target.value })}
              />
              <Input placeholder="Notes" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={async () => {
              let per_unit: Record<string, number> = {};
              try { per_unit = JSON.parse(draft.per_unit_json ?? "{}"); }
              catch { toast.error("Invalid per-unit JSON"); return; }
              const r = await upsertFn({ data: { id: draft.id, kind: draft.kind, base_cost: draft.base_cost, per_unit, notes: draft.notes || null } });
              if (r.ok) { toast.success("Saved"); setOpen(false); qc.invalidateQueries({ queryKey: ["rates"] }); } else toast.error(r.error);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── API Keys ────────────────────────────────────────────────────────────────

function KeysTab() {
  const listFn = useServerFn(listCloneApiKeys);
  const createFn = useServerFn(createCloneApiKey);
  const revokeFn = useServerFn(revokeCloneApiKey);
  const rotateFn = useServerFn(rotateCloneApiKey);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["clone-api-keys"], queryFn: () => listFn({ data: {} }) });
  const { data: clones } = useQuery({
    queryKey: ["clones-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clones").select("id, name, slug").order("name");
      return data ?? [];
    },
  });
  const [open, setOpen] = useState(false);
  const [cloneId, setCloneId] = useState("");
  const [label, setLabel] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Clone API keys</CardTitle>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setIssuedKey(null); setLabel(""); setCloneId(""); } }}>
          <DialogTrigger asChild><Button size="sm"><KeyRound className="mr-1 h-3 w-3" />Issue key</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{issuedKey ? "Key issued" : "Issue clone API key"}</DialogTitle></DialogHeader>
            {issuedKey ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Copy this key now — it will not be shown again.</p>
                <div className="flex items-center gap-2 rounded border border-border bg-muted/30 p-2 font-mono text-xs">
                  <span className="flex-1 break-all">{issuedKey}</span>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(issuedKey); toast.success("Copied"); }}><Copy className="h-3 w-3" /></Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 text-sm">
                <Select value={cloneId} onValueChange={setCloneId}>
                  <SelectTrigger><SelectValue placeholder="Pick target…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__prime__">Prime repo (Mission Control)</SelectItem>
                    {clones?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Label (e.g. prod, staging)" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
            )}
            <DialogFooter>
              {issuedKey ? <Button onClick={() => setOpen(false)}>Done</Button> : (
                <Button disabled={!cloneId || !label} onClick={async () => {
                  const targetCloneId = cloneId === "__prime__" ? null : cloneId;
                  const r = await createFn({ data: { cloneId: targetCloneId, label, scopes: ["tokens:meter"] } });
                  if (r.ok) { setIssuedKey(r.key); qc.invalidateQueries({ queryKey: ["clone-api-keys"] }); } else toast.error(r.error);
                }}>Issue</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Clone</TableHead><TableHead>Label</TableHead><TableHead>Prefix</TableHead><TableHead>Last used</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.keys.map((k: any) => (
              <TableRow key={k.id}>
                <TableCell>{k.clones?.name ?? <span className="font-mono text-xs text-muted-foreground">prime repo</span>}</TableCell>
                <TableCell>{k.label}</TableCell>
                <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                <TableCell className="text-xs">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}</TableCell>
                <TableCell>
                  {k.revoked_at ? <Badge variant="destructive">revoked</Badge>
                    : k.revoke_at ? <Badge variant="outline">grace · revokes {new Date(k.revoke_at).toLocaleString()}</Badge>
                    : <Badge>active</Badge>}
                </TableCell>
                <TableCell className="flex gap-1">
                  {!k.revoked_at && !k.revoke_at && (
                    <Button size="sm" variant="ghost" title="Rotate (issue new + grace period)" onClick={async () => {
                      const hoursStr = prompt("Grace period in hours before old key is revoked?", "24");
                      if (hoursStr == null) return;
                      const graceHours = Math.max(0, parseInt(hoursStr, 10) || 0);
                      const r = await rotateFn({ data: { oldKeyId: k.id, graceHours } });
                      if (r.ok) {
                        await navigator.clipboard.writeText(r.key).catch(() => {});
                        toast.success(`New key copied. Old revokes at ${new Date(r.revokeAt).toLocaleString()}`);
                        qc.invalidateQueries({ queryKey: ["clone-api-keys"] });
                      } else toast.error(r.error);
                    }}><RotateCw className="h-3 w-3" /></Button>
                  )}
                  {!k.revoked_at && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (!confirm("Revoke this key? Calls using it will fail immediately.")) return;
                      const r = await revokeFn({ data: { id: k.id } });
                      if (r.ok) { toast.success("Revoked"); qc.invalidateQueries({ queryKey: ["clone-api-keys"] }); } else toast.error(r.error);
                    }}><Trash2 className="h-3 w-3" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!data?.keys.length && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No keys issued.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
