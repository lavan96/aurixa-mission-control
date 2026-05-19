import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Users, ArrowLeft, ShieldCheck, Smartphone, X } from "lucide-react";
import {
  listSeatPlans,
  listSeatEntitlements,
  assignSeatPlan,
  listSeatAudit,
} from "@/lib/seats.functions";
import { listSeatDevices, revokeSeatDevice, seatDeviceSummary } from "@/lib/seat-devices.functions";

export const Route = createFileRoute("/billing/seats")({
  component: () => (
    <ProtectedRoute>
      <SeatsPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Seat Plans — Mission Control" }] }),
});

function money(cents: number, ccy = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(cents / 100);
}

function SeatsPage() {
  const qc = useQueryClient();
  const plansFn = useServerFn(listSeatPlans);
  const entsFn = useServerFn(listSeatEntitlements);
  const auditFn = useServerFn(listSeatAudit);
  const assignFn = useServerFn(assignSeatPlan);

  const plansQ = useQuery({ queryKey: ["seats", "plans"], queryFn: () => plansFn({}) });
  const entsQ = useQuery({ queryKey: ["seats", "ents"], queryFn: () => entsFn({}) });
  const auditQ = useQuery({ queryKey: ["seats", "audit"], queryFn: () => auditFn({ data: { limit: 50 } }) });

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"price-asc" | "price-desc" | "seats-asc" | "seats-desc">("price-asc");

  const plans = plansQ.data?.plans ?? [];
  const filtered = useMemo(() => {
    const lc = query.trim().toLowerCase();
    const filtered = plans.filter(
      (p) => !lc || p.slug.includes(lc) || p.name.toLowerCase().includes(lc),
    );
    return filtered.sort((a, b) => {
      if (sort === "price-asc") return a.price_cents - b.price_cents;
      if (sort === "price-desc") return b.price_cents - a.price_cents;
      if (sort === "seats-asc") return a.seat_limit - b.seat_limit;
      return b.seat_limit - a.seat_limit;
    });
  }, [plans, query, sort]);

  const assign = async (cloneId: string | null, planId: string) => {
    try {
      await assignFn({ data: { cloneId, seatPlanId: planId, notes: null } });
      toast.success("Plan assigned");
      qc.invalidateQueries({ queryKey: ["seats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">monetization</p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-6 w-6" /> Seat Plans
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Seat entitlements per clone. Prime repo baseline is the Starter tier (4 seats).
          </p>
        </div>
        <Link to="/settings/billing" className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> billing
        </Link>
      </div>

      {/* Catalog */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan catalog</CardTitle>
          <CardDescription>Mock pricing — wire to a real billing provider later.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plan name or slug…"
              className="max-w-xs"
            />
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="price-asc">Price ↑</SelectItem>
                <SelectItem value="price-desc">Price ↓</SelectItem>
                <SelectItem value="seats-asc">Seats ↑</SelectItem>
                <SelectItem value="seats-desc">Seats ↓</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {filtered.map((p) => (
              <Card key={p.id} className="border-border/60">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    {p.is_default && (
                      <Badge variant="outline" className="font-mono text-[10px]">DEFAULT</Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">{p.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="text-2xl font-semibold tracking-tight">
                    {p.price_cents === 0 ? "Free" : money(p.price_cents, p.currency)}
                    {p.price_cents !== 0 && <span className="text-xs text-muted-foreground"> /mo</span>}
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Seats</span><span className="font-mono text-foreground">{p.seat_limit}</span></div>
                    <div className="flex justify-between"><span>Devices / seat</span><span className="font-mono text-foreground">{p.device_limit_per_seat ?? "∞"}</span></div>
                    <div className="flex justify-between"><span>Overage</span><span className="font-mono">{p.overage_policy}</span></div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => assign(null, p.id)}
                  >
                    Apply to Prime
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Entitlements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Active entitlements
          </CardTitle>
          <CardDescription>Per-clone seat usage. Change plan inline.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clone</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-48">Change plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entsQ.data?.entitlements ?? []).map((e) => {
                const used = e.seats_used ?? 0;
                const limit = e.plan?.seat_limit ?? 0;
                const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">
                      {e.clone?.name ?? <span className="text-muted-foreground">Prime repo</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.plan?.name ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="w-56">
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-2" />
                        <span className="font-mono text-xs whitespace-nowrap">{used}/{limit}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge>{e.status}</Badge></TableCell>
                    <TableCell>
                      <Select onValueChange={(v) => assign(e.clone_id, v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Pick plan…" /></SelectTrigger>
                        <SelectContent>
                          {plans.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name} — {p.seat_limit} seats</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(entsQ.data?.entitlements ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                    No entitlements yet. Apply a plan above to seed Prime, or wait for clones to call the API.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Audit */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent seat activity</CardTitle>
          <CardDescription>Last 50 reserve/commit/release/plan-change events.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Clone</TableHead>
                <TableHead>User</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(auditQ.data?.entries ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{a.action}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{a.clone_id?.slice(0, 8) ?? "prime"}</TableCell>
                  <TableCell className="font-mono text-xs">{a.external_user_id ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(auditQ.data?.entries ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No activity yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
