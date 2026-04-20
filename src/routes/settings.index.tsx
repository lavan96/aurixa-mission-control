import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { usePrimeConfig } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Cloud, Sparkles, Zap } from "lucide-react";
import { GitHubStatusCard } from "@/components/github-status-card";
import { WebhookDeliveriesPanel } from "@/components/webhook-deliveries-panel";
import type { Database } from "@/integrations/supabase/types";

type CascadeMode = Database["public"]["Enums"]["cascade_mode"];

export const Route = createFileRoute("/settings/")({
  component: () => (
    <ProtectedRoute>
      <SettingsGeneralPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Settings — Aurixa Systems Mission Control" }] }),
});

function SettingsGeneralPage() {
  const { data: prime, loading: primeLoading, error: primeError, refresh } = usePrimeConfig();
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [defaultOrg, setDefaultOrg] = useState("");
  const [cascadeMode, setCascadeMode] = useState<CascadeMode>("pr");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the form once when the prime row loads. Without the `hydrated`
  // guard, every refresh() (e.g. after a save) would overwrite in-progress
  // edits — and if `prime` flips back to null briefly during a re-fetch we
  // would *not* clobber the form to empty.
  useEffect(() => {
    if (prime && !hydrated) {
      setOwner(prime.github_owner);
      setRepo(prime.github_repo);
      setBranch(prime.default_branch);
      setDefaultOrg(prime.default_clone_org ?? "");
      setCascadeMode(prime.default_cascade_mode);
      setHydrated(true);
    }
  }, [prime, hydrated]);

  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!owner.trim() || !repo.trim()) return toast.error("Owner and repo required");
    if (!branch.trim()) return toast.error("Default branch required");
    setSaving(true);
    const payload = {
      github_owner: owner.trim(),
      github_repo: repo.trim(),
      default_branch: branch.trim(),
      default_clone_org: defaultOrg.trim() || null,
      default_cascade_mode: cascadeMode,
    };
    try {
      // Re-check for an existing row right before write so a stale `prime`
      // snapshot doesn't make us insert a duplicate after another tab saved.
      const { data: existing, error: lookupErr } = await supabase
        .from("prime_config")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (lookupErr) throw lookupErr;

      if (existing) {
        const { error } = await supabase
          .from("prime_config")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("prime_config").insert(payload);
        if (error) throw error;
      }
      toast.success("Prime config saved");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save prime config";
      // Surface the real DB error (RLS, NOT NULL, etc.) instead of swallowing.
      toast.error(msg);
      console.error("Prime config save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="h-4 w-4" /> Prime repository
          </CardTitle>
          <CardDescription>The single source-of-truth codebase that all clones cascade from.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>GitHub owner</Label>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="my-org" />
          </div>
          <div className="space-y-2">
            <Label>Repo</Label>
            <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="prime-codebase" />
          </div>
          <div className="space-y-2">
            <Label>Default branch</Label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Default org for new clones</Label>
            <Input value={defaultOrg} onChange={(e) => setDefaultOrg(e.target.value)} placeholder="my-org" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Default cascade mode (used on commit webhooks)
            </Label>
            <Select value={cascadeMode} onValueChange={(v) => setCascadeMode(v as CascadeMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pr">
                  PR — open a pull request on each clone for human review
                </SelectItem>
                <SelectItem value="auto_merge">
                  Auto-merge — push directly to each clone's default branch
                </SelectItem>
                <SelectItem value="notify">
                  Notify only — record the event, take no action
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save prime config"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <GitHubStatusCard />

      <WebhookDeliveriesPanel />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="h-4 w-4" /> GitHub App
          </CardTitle>
          <CardDescription>
            Install the GitHub App on the org that will own clones to enable repo creation and PRs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline">Install GitHub App</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-accent" /> AI Layer
          </CardTitle>
          <CardDescription>
            Module detection, code automation, and the autonomous fleet manager — powered by the
            Lovable AI Gateway. No setup required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>· Module detection: <span className="font-mono text-foreground">enabled</span></div>
          <div>· Code automation: <span className="font-mono text-foreground">enabled</span></div>
          <div>· Autonomous fleet manager: <span className="font-mono text-foreground">enabled</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4 text-info" /> Cloudflare
          </CardTitle>
          <CardDescription>API token requested on first use.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
