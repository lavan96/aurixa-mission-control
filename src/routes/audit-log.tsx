import { createFileRoute, Link } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollText, Filter, RefreshCw, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/format";

type AuditLog = Database["public"]["Tables"]["audit_log"]["Row"];

export const Route = createFileRoute("/audit-log")({
  component: () => (
    <ProtectedRoute>
      <AuditLogPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Audit Log — Mission Control" }] }),
});

const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  { value: "cascade.executed", label: "Cascades executed" },
  { value: "fleet.drift_scan", label: "Fleet drift scans" },
  { value: "modules.detected", label: "Module detections" },
];

const ENTITY_OPTIONS = [
  { value: "all", label: "All entities" },
  { value: "cascade_event", label: "Cascade events" },
  { value: "clone", label: "Clones" },
  { value: "module", label: "Modules" },
];

function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string>("all");
  const [entity, setEntity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
    if (action !== "all") q = q.eq("action", action);
    if (entity !== "all") q = q.eq("entity_type", entity);
    const { data } = await q;
    setLogs(data ?? []);
    setLoading(false);
  }, [action, entity]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = search
    ? logs.filter(
        (l) =>
          l.action.toLowerCase().includes(search.toLowerCase()) ||
          (l.entity_type ?? "").toLowerCase().includes(search.toLowerCase()) ||
          JSON.stringify(l.metadata).toLowerCase().includes(search.toLowerCase()),
      )
    : logs;

  const hasFilters = action !== "all" || entity !== "all" || search.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/40">
            <ScrollText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              timeline
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit Log</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every cascade, detection, and drift scan in one place.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Input
              placeholder="Search actions, metadata…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2"
                onClick={() => {
                  setAction("all");
                  setEntity("all");
                  setSearch("");
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription className="font-mono text-[11px] uppercase tracking-wider">
            {visible.length} {visible.length === 1 ? "entry" : "entries"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No audit entries match these filters.
            </div>
          ) : (
            <ol className="relative">
              {visible.map((log, i) => (
                <LogRow
                  key={log.id}
                  log={log}
                  isLast={i === visible.length - 1}
                  expanded={expanded === log.id}
                  onToggle={() => setExpanded(expanded === log.id ? null : log.id)}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogRow({
  log,
  isLast,
  expanded,
  onToggle,
}: {
  log: AuditLog;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tone = actionTone(log.action);
  const link = entityLink(log);

  return (
    <li className={cn("relative px-4 py-3", !isLast && "border-b border-border/60")}>
      <div className="flex items-start gap-3">
        <div className="relative flex flex-col items-center pt-1">
          <div className={cn("h-2 w-2 rounded-full ring-2 ring-background", tone.dot)} />
          {!isLast && <div className="absolute top-3 h-full w-px bg-border/60" />}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className={cn("font-mono text-sm font-medium", tone.text)}>
              {log.action}
            </code>
            {log.entity_type && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {log.entity_type}
              </Badge>
            )}
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatDistanceToNow(log.created_at)}
            </span>
          </div>
          {!expanded && Object.keys(log.metadata as object).length > 0 && (
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {summarizeMeta(log.metadata)}
            </div>
          )}
          {expanded && (
            <pre className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-muted p-2 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(log.metadata, null, 2)}
            </pre>
          )}
        </button>
        {link && (
          <Link
            to={link.to}
            params={link.params}
            className="inline-flex items-center font-mono text-[11px] text-accent hover:underline"
          >
            view <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </li>
  );
}

function summarizeMeta(meta: AuditLog["metadata"]): string {
  if (!meta || typeof meta !== "object") return "";
  const m = meta as Record<string, unknown>;
  return Object.entries(m)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function entityLink(log: AuditLog):
  | { to: "/cascades/$eventId"; params: { eventId: string } }
  | null {
  if (log.entity_type === "cascade_event" && log.entity_id) {
    return { to: "/cascades/$eventId", params: { eventId: log.entity_id } };
  }
  return null;
}

function actionTone(action: string): { dot: string; text: string } {
  if (action.startsWith("cascade")) return { dot: "bg-info", text: "text-foreground" };
  if (action.startsWith("fleet")) return { dot: "bg-accent", text: "text-foreground" };
  if (action.startsWith("modules")) return { dot: "bg-primary", text: "text-foreground" };
  if (action.includes("fail") || action.includes("error"))
    return { dot: "bg-destructive", text: "text-destructive" };
  return { dot: "bg-muted-foreground", text: "text-foreground" };
}
