import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Receipt, RotateCw, X } from "lucide-react";
import { listReportJobs, listTenants } from "@/lib/tokens.functions";
import { formatDistanceToNow } from "@/lib/format";

export const Route = createFileRoute("/report-jobs")({
  component: () => (
    <ProtectedRoute>
      <ReportJobsPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Report Jobs — Mission Control" }] }),
});

type Status = "reserved" | "completed" | "canceled" | "refunded" | "failed" | "pending";

const STATUS_VARIANTS: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  reserved: "outline",
  completed: "default",
  canceled: "secondary",
  refunded: "secondary",
  failed: "destructive",
  pending: "outline",
};

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

function ReportJobsPage() {
  const listJobs = useServerFn(listReportJobs);
  const listTenantsFn = useServerFn(listTenants);

  const [tenantId, setTenantId] = useState<string | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(100);

  const tenantsQ = useQuery({
    queryKey: ["tenants", "all"],
    queryFn: () => listTenantsFn({ data: { limit: 500 } }),
  });

  const filters = useMemo(
    () => ({
      tenantId: tenantId === "all" ? undefined : tenantId,
      status: status === "all" ? undefined : status,
      search: search.trim() || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to + "T23:59:59").toISOString() : undefined,
      limit,
    }),
    [tenantId, status, search, from, to, limit],
  );

  const jobsQ = useQuery({
    queryKey: ["report-jobs", filters],
    queryFn: () => listJobs({ data: filters }),
  });

  const totals = jobsQ.data?.totals;

  const reset = () => {
    setTenantId("all");
    setStatus("all");
    setSearch("");
    setFrom("");
    setTo("");
    setLimit(100);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
          <Receipt className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            metering · admin
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Report Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Every token reservation, commit, cancel, and refund across the fleet.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => jobsQ.refetch()}>
          <RotateCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <Link
          to="/settings/billing"
          className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          billing →
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Jobs" value={fmt(totals?.jobs)} />
        <StatCard label="Reserved" value={fmt(totals?.reserved)} hint="estimated" />
        <StatCard label="Committed" value={fmt(totals?.committed)} hint="actual" />
        <StatCard label="Canceled" value={fmt(totals?.canceled)} hint="released" />
        <StatCard label="Refunded" value={fmt(totals?.refunded)} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Select value={tenantId} onValueChange={(v) => setTenantId(v as string)}>
            <SelectTrigger><SelectValue placeholder="Tenant" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tenants</SelectItem>
              {(tenantsQ.data?.tenants ?? []).map((t: any) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.display_name ?? t.external_ref ?? t.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as Status | "all")}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="reserved">Reserved</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search kind / idempotency key"
          />
          <div className="flex gap-2">
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[50, 100, 250, 500].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={reset} title="Clear filters">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {jobsQ.isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (jobsQ.data?.jobs.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Receipt />}
              title="No report jobs match these filters"
              description="Adjust the date range or clear filters to see all activity."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Clone</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="font-mono text-[10px]">Idempotency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobsQ.data?.jobs ?? []).map((j: any) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-sm">
                      {j.tenants?.display_name ?? j.tenants?.external_ref ?? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {j.tenant_id.slice(0, 8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {j.clones?.name ?? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {j.clone_id.slice(0, 8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{j.kind}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[j.status as Status] ?? "outline"}>
                        {j.status}
                      </Badge>
                      {j.error && (
                        <p className="mt-1 text-[10px] text-destructive">{j.error}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmt(j.estimated_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {j.charged_tokens != null ? fmt(j.charged_tokens) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(j.started_at)}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {j.idempotency_key}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
