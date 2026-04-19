import { createFileRoute, Link } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  Filter,
  RefreshCw,
  X,
  CheckCheck,
  Inbox,
  CircleDot,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GitFork,
  Trash2,
  Boxes,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/format";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];
type Clone = Pick<Database["public"]["Tables"]["clones"]["Row"], "id" | "name">;
type Kind = Database["public"]["Enums"]["notification_kind"];
type Severity = Database["public"]["Enums"]["notification_severity"];

const PAGE_SIZE = 25;

const KIND_OPTIONS: { value: Kind | "all"; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "cascade_started", label: "Cascade started" },
  { value: "cascade_completed", label: "Cascade completed" },
  { value: "cascade_partial", label: "Cascade partial" },
  { value: "cascade_failed", label: "Cascade failed" },
  { value: "drift_high", label: "Drift — high" },
  { value: "drift_medium", label: "Drift — medium" },
  { value: "clone_created", label: "Clone created" },
  { value: "clone_deleted", label: "Clone deleted" },
  { value: "module_installed", label: "Module installed" },
  { value: "module_removed", label: "Module removed" },
];

const SEVERITY_OPTIONS: { value: Severity | "all"; label: string }[] = [
  { value: "all", label: "All severities" },
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
];

const READ_OPTIONS = [
  { value: "all", label: "Read & unread" },
  { value: "unread", label: "Unread only" },
  { value: "read", label: "Read only" },
];

export const Route = createFileRoute("/notifications")({
  component: () => (
    <ProtectedRoute>
      <NotificationsPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Notifications — Mission Control" }] }),
});

function iconFor(kind: Kind) {
  switch (kind) {
    case "cascade_completed":
      return CheckCircle2;
    case "cascade_failed":
      return XCircle;
    case "cascade_partial":
    case "drift_high":
    case "drift_medium":
      return AlertTriangle;
    case "cascade_started":
      return CircleDot;
    case "clone_created":
      return GitFork;
    case "clone_deleted":
      return Trash2;
    case "module_installed":
    case "module_removed":
      return Boxes;
    default:
      return CircleDot;
  }
}

function tone(severity: Severity) {
  switch (severity) {
    case "success":
      return "text-success";
    case "error":
      return "text-destructive";
    case "warning":
      return "text-warning";
    default:
      return "text-info";
  }
}

function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clones, setClones] = useState<Clone[]>([]);

  const [kind, setKind] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [cloneId, setCloneId] = useState<string>("all");
  const [readState, setReadState] = useState<string>("all");
  const [page, setPage] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let q = supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (kind !== "all") q = q.eq("kind", kind as Kind);
    if (severity !== "all") q = q.eq("severity", severity as Severity);
    if (cloneId !== "all") q = q.eq("clone_id", cloneId);
    if (readState === "unread") q = q.is("read_at", null);
    if (readState === "read") q = q.not("read_at", "is", null);
    const { data, count } = await q;
    setItems(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [kind, severity, cloneId, readState, page]);

  // Reset to page 0 whenever filters change
  useEffect(() => {
    setPage(0);
  }, [kind, severity, cloneId, readState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load clones for the filter dropdown (one-shot)
  useEffect(() => {
    void supabase
      .from("clones")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => setClones(data ?? []));
  }, []);

  // Live updates: refresh current page on insert/update
  useEffect(() => {
    const channel = supabase
      .channel("notif:page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const unreadOnPage = useMemo(() => items.filter((n) => !n.read_at), [items]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    kind !== "all" || severity !== "all" || cloneId !== "all" || readState !== "all";

  const markAllOnPageRead = async () => {
    const ids = unreadOnPage.map((n) => n.id);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)),
    );
    await supabase.from("notifications").update({ read_at: now }).in("id", ids);
  };

  const markOneRead = async (id: string) => {
    if (items.find((n) => n.id === id)?.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  };

  const clearFilters = () => {
    setKind("all");
    setSeverity("all");
    setCloneId("all");
    setReadState("all");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              inbox
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Notifications</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Full history of cascade outcomes, drift findings, and fleet activity.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={markAllOnPageRead}
            disabled={unreadOnPage.length === 0}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
            Mark page read
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={cloneId} onValueChange={setCloneId}>
            <SelectTrigger>
              <SelectValue placeholder="All clones" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clones</SelectItem>
              {clones.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Select value={readState} onValueChange={setReadState}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {READ_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={clearFilters}
                title="Clear filters"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardDescription className="font-mono text-[11px] uppercase tracking-wider">
            {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
            {total > 0 && (
              <span className="ml-2 text-muted-foreground/70">
                · page {page + 1} of {totalPages}
              </span>
            )}
          </CardDescription>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPage((p) => p + 1)}
              disabled={page + 1 >= totalPages || loading}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Inbox className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No notifications match these filters.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => {
                const Icon = iconFor(n.kind);
                const unread = !n.read_at;
                const inner = (
                  <div
                    className={cn(
                      "flex gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
                      unread && "bg-primary/[0.04]",
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone(n.severity))} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {n.title}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {n.kind.replace(/_/g, " ")}
                        </Badge>
                        {unread && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </div>
                      {n.body && (
                        <p className="mt-1 text-xs text-muted-foreground">{n.body}</p>
                      )}
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {formatDistanceToNow(n.created_at)}
                      </p>
                    </div>
                  </div>
                );

                const handleClick = () => void markOneRead(n.id);

                if (n.url) {
                  return (
                    <li key={n.id}>
                      <Link to={n.url} onClick={handleClick} className="block">
                        {inner}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={handleClick}
                      className="block w-full text-left"
                    >
                      {inner}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
