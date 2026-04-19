import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { useModules, usePrimeConfig } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Boxes, Sparkles, Check, X, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/modules")({
  component: () => (
    <ProtectedRoute>
      <ModulesPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Modules — Mission Control" }] }),
});

function ModulesPage() {
  const { data: modules, refresh } = useModules();
  const { data: prime } = usePrimeConfig();
  const [scanning, setScanning] = useState(false);

  const runDetection = async () => {
    if (!prime) return toast.error("Configure prime repo first");
    setScanning(true);
    // Placeholder: in production this calls a server function that uses Lovable AI
    // Gateway (google/gemini-3-flash-preview, reasoning: high) to scan the repo
    // and propose module boundaries.
    const proposed = [
      {
        name: "Auth",
        slug: "auth",
        description: "Login, signup, session, password reset",
        file_globs: ["src/lib/auth.tsx", "src/routes/auth.tsx", "src/components/protected-route.tsx"],
        routes: ["/auth"],
        ai_confidence: 0.94,
      },
      {
        name: "Marketing Pages",
        slug: "marketing-pages",
        description: "Landing, about, pricing, contact static routes",
        file_globs: ["src/routes/index.tsx", "src/routes/about.tsx", "src/routes/pricing.tsx"],
        routes: ["/", "/about", "/pricing", "/contact"],
        ai_confidence: 0.88,
      },
      {
        name: "Billing",
        slug: "billing",
        description: "Stripe checkout, subscriptions, invoices",
        file_globs: ["src/routes/billing.tsx", "supabase/functions/stripe-*"],
        routes: ["/billing"],
        ai_confidence: 0.91,
      },
      {
        name: "Dashboard Core",
        slug: "dashboard-core",
        description: "Main authenticated dashboard shell and widgets",
        file_globs: ["src/routes/dashboard.tsx", "src/components/app-shell.tsx"],
        routes: ["/dashboard"],
        ai_confidence: 0.96,
      },
    ];
    for (const p of proposed) {
      await supabase.from("modules").upsert(
        { ...p, status: "proposed", detected_by_ai: true },
        { onConflict: "slug", ignoreDuplicates: true },
      );
    }
    await new Promise((r) => setTimeout(r, 600));
    setScanning(false);
    toast.success(`Detected ${proposed.length} modules — review below`);
    refresh();
  };

  const setStatus = async (id: string, status: "approved" | "archived") => {
    await supabase.from("modules").update({ status }).eq("id", id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            module catalog
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Modules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-detected slices of the prime codebase. Approve or edit before injecting into clones.
          </p>
        </div>
        <Button onClick={runDetection} disabled={scanning}>
          <Sparkles className="mr-2 h-4 w-4" />
          {scanning ? "Scanning prime…" : "Run AI detection"}
        </Button>
      </header>

      {modules.length === 0 ? (
        <div className="grid-bg flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/30 p-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30">
            <Boxes className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-mono text-lg font-semibold">Catalog is empty</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Run AI detection to scan your prime repo and propose module boundaries by folders,
            routes, and import graphs.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {modules.map((m) => (
            <ModuleRow
              key={m.id}
              module={m}
              onApprove={() => setStatus(m.id, "approved")}
              onArchive={() => setStatus(m.id, "archived")}
              onEdited={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleRow({
  module: m,
  onApprove,
  onArchive,
  onEdited,
}: {
  module: ReturnType<typeof useModules>["data"][number];
  onApprove: () => void;
  onArchive: () => void;
  onEdited: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(m.name);
  const [desc, setDesc] = useState(m.description ?? "");

  const save = async () => {
    await supabase.from("modules").update({ name, description: desc }).eq("id", m.id);
    setEdit(false);
    toast.success("Saved");
    onEdited();
  };

  const tone =
    m.status === "approved"
      ? "border-success/40 text-success"
      : m.status === "archived"
        ? "border-muted text-muted-foreground"
        : "border-warning/40 text-warning";

  return (
    <Card className="border-border/80">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex-1">
          {edit ? (
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          ) : (
            <CardTitle className="text-base font-mono">{m.name}</CardTitle>
          )}
          <CardDescription className="mt-1 font-mono text-[11px]">{m.slug}</CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] uppercase ${tone}`}>
            {m.status}
          </Badge>
          {m.ai_confidence != null && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {Math.round(Number(m.ai_confidence) * 100)}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {edit ? (
          <Textarea value={desc} rows={2} onChange={(e) => setDesc(e.target.value)} />
        ) : (
          <p className="text-sm text-muted-foreground">{m.description || "—"}</p>
        )}
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            routes
          </div>
          <div className="flex flex-wrap gap-1">
            {(m.routes ?? []).map((r) => (
              <code key={r} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {r}
              </code>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            files
          </div>
          <div className="flex flex-wrap gap-1">
            {(m.file_globs ?? []).slice(0, 3).map((f) => (
              <code key={f} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {f}
              </code>
            ))}
            {(m.file_globs ?? []).length > 3 && (
              <span className="text-[11px] text-muted-foreground">
                +{(m.file_globs ?? []).length - 3} more
              </span>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {edit ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save}>Save</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {m.status !== "approved" && (
                <Button size="sm" variant="outline" onClick={onApprove}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Approve
                </Button>
              )}
              {m.status !== "archived" && (
                <Button size="sm" variant="ghost" onClick={onArchive}>
                  <X className="mr-1 h-3.5 w-3.5" /> Archive
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
