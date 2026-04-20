import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { usePrimeConfig } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Cloud, Sparkles } from "lucide-react";
import { GitHubStatusCard } from "@/components/github-status-card";

export const Route = createFileRoute("/settings/")({
  component: () => (
    <ProtectedRoute>
      <SettingsGeneralPage />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Settings — Aurixa Systems Mission Control" }] }),
});

function SettingsGeneralPage() {
  const { data: prime, refresh } = usePrimeConfig();
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [defaultOrg, setDefaultOrg] = useState("");

  useEffect(() => {
    if (prime) {
      setOwner(prime.github_owner);
      setRepo(prime.github_repo);
      setBranch(prime.default_branch);
      setDefaultOrg(prime.default_clone_org ?? "");
    }
  }, [prime]);

  const save = async () => {
    if (!owner || !repo) return toast.error("Owner and repo required");
    if (prime) {
      await supabase
        .from("prime_config")
        .update({ github_owner: owner, github_repo: repo, default_branch: branch, default_clone_org: defaultOrg || null })
        .eq("id", prime.id);
    } else {
      await supabase
        .from("prime_config")
        .insert({ github_owner: owner, github_repo: repo, default_branch: branch, default_clone_org: defaultOrg || null });
    }
    toast.success("Prime config saved");
    refresh();
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
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={save}>Save prime config</Button>
          </div>
        </CardContent>
      </Card>

      <GitHubStatusCard />

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
