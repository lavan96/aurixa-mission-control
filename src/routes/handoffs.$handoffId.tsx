// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  getHandoff,
  transitionHandoff,
  recordHandoffSnapshot,
  recordSecretRotation,
  requestCostExport,
  runParityDryRun,
  HANDOFF_STATE_ORDER,
} from "@/lib/handoffs.functions";
import {
  createHandoffInvite,
  listHandoffInvites,
  revokeHandoffInvite,
} from "@/lib/handoff-invites.functions";
import { verifyCloneRepoGithubAccess, type CloneGithubAccessRow } from "@/lib/clone-github-access.functions";
import { getHandoffContractDocumentUrl } from "@/lib/handoff-terms.functions";
import { ArrowRight, Camera, KeyRound, FileDown, ScrollText, ShieldCheck, Github, Link as LinkIcon, Copy, Trash2, FileText } from "lucide-react";

export const Route = createFileRoute("/handoffs/$handoffId")({
  component: () => (
    <ProtectedRoute>
      <HandoffDetail />
    </ProtectedRoute>
  ),
  head: () => ({ meta: [{ title: "Handoff — Aurixa Systems" }] }),
});

function HandoffDetail() {
  const { handoffId } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["handoff", handoffId],
    queryFn: () => getHandoff({ data: { id: handoffId } }),
    refetchInterval: 15000,
  });

  const nextStateOf = (s: string) => {
    const i = HANDOFF_STATE_ORDER.indexOf(s as any);
    if (i < 0 || i >= HANDOFF_STATE_ORDER.length - 1) return null;
    return HANDOFF_STATE_ORDER[i + 1];
  };

  const advance = useMutation({
    mutationFn: (to: string) =>
      transitionHandoff({ data: { id: handoffId, to_state: to as any } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      toast.success("State advanced");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const snapshot = useMutation({
    mutationFn: (kind: string) =>
      recordHandoffSnapshot({
        data: { handoff_id: handoffId, kind: kind as any, retention_days: 30 },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      toast.success("Snapshot enqueued");
    },
  });

  const rotate = useMutation({
    mutationFn: (target: string) =>
      recordSecretRotation({
        data: { handoff_id: handoffId, target: target as any, key_ref: `${target}-primary` },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      toast.success("Rotation enqueued");
    },
  });

  const exportCost = useMutation({
    mutationFn: () => {
      const now = new Date();
      const start = new Date(now.getTime() - 90 * 86400000);
      return requestCostExport({
        data: {
          handoff_id: handoffId,
          period_start: start.toISOString(),
          period_end: now.toISOString(),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      toast.success("Export requested");
    },
  });

  const parity = useMutation({
    mutationFn: () => runParityDryRun({ data: { handoff_id: handoffId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false) {
        toast.error(`Parity failed: ${r.error}`);
        return;
      }
      const blockers = r?.blocking_issues?.length ?? 0;
      if (blockers === 0)
        toast.success(`Parity clean · risk=${r.risk_level}${r.advanced ? " · advanced to dry_run_ready" : ""}`);
      else toast.warning(`Parity risk=${r.risk_level} · ${blockers} blocking issue(s)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Parity run failed"),
  });

  // G9 — verify the Aurixa GitHub App still has access to the clone repo.
  const [gh, setGh] = useState<CloneGithubAccessRow | null>(null);
  const ghCheck = useMutation({
    mutationFn: () => {
      const cloneId = q.data?.handoff?.clone_id as string | undefined;
      if (!cloneId) throw new Error("Clone id not loaded yet");
      return verifyCloneRepoGithubAccess({ data: { cloneId } });
    },
    onSuccess: (r) => {
      setGh(r);
      if (r.ok) toast.success("GitHub App has access to the clone repo.");
      else toast.warning(r.message ?? "GitHub App access check failed.");
    },
    onError: (e: any) => toast.error(e?.message ?? "GitHub check failed"),
  });

  if (q.isLoading) return <div className="p-6">Loading…</div>;
  const d = q.data;
  if (!d?.handoff) return <div className="p-6">Not found</div>;
  const h = d.handoff;
  const next = nextStateOf(h.state);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{h.clones?.name ?? h.clone_id}</h1>
          <p className="text-sm text-muted-foreground">
            {h.path} · {h.target_region ?? "no region"} · {h.target_plan_tier ?? "no plan"}
          </p>
        </div>
        <Badge>{h.state}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>State machine</CardTitle>
          <CardDescription>Advance through the handoff lifecycle.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {next && (
            <Button size="sm" onClick={() => advance.mutate(next)} disabled={advance.isPending}>
              Advance → {next} <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => advance.mutate("canceled")}>Cancel</Button>
          <Button size="sm" variant="destructive" onClick={() => advance.mutate("rolled_back")}>Roll back</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Camera className="h-4 w-4" /> Snapshots (E4)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              {(["pitr_pin", "pg_dump", "storage_export", "auth_export"] as const).map((k) => (
                <Button key={k} size="sm" variant="outline" onClick={() => snapshot.mutate(k)}>
                  {k}
                </Button>
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {d.snapshots.map((s: any) => (
                <li key={s.id} className="flex justify-between border-b py-1">
                  <span>{s.kind}</span>
                  <Badge variant="outline">{s.status}</Badge>
                </li>
              ))}
              {d.snapshots.length === 0 && <li className="text-muted-foreground">none</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Secret rotations (E5)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              {(["clone_repo", "cloudflare", "stripe_endpoint", "github_webhook", "edge_function_env"] as const).map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => rotate.mutate(t)}>{t}</Button>
              ))}
            </div>
            <ul className="mt-2 space-y-1">
              {d.rotations.map((r: any) => (
                <li key={r.id} className="flex justify-between border-b py-1">
                  <span>{r.target} · {r.key_ref}</span>
                  <Badge variant="outline">{r.status}</Badge>
                </li>
              ))}
              {d.rotations.length === 0 && <li className="text-muted-foreground">none</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileDown className="h-4 w-4" /> Cost exports (E8)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Button size="sm" variant="outline" onClick={() => exportCost.mutate()}>Request 90d export</Button>
            <ul className="mt-2 space-y-1">
              {d.cost_exports.map((e: any) => (
                <li key={e.id} className="flex justify-between border-b py-1">
                  <span>{new Date(e.period_start).toLocaleDateString()} → {new Date(e.period_end).toLocaleDateString()}</span>
                  <Badge variant="outline">{e.status}</Badge>
                </li>
              ))}
              {d.cost_exports.length === 0 && <li className="text-muted-foreground">none</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Parity + contracts (E2, E7 · G1)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Button size="sm" variant="outline" onClick={() => parity.mutate()} disabled={parity.isPending}>
              {parity.isPending ? "Running…" : "Run parity dry-run"}
            </Button>
            {d.parity_reports[0] && (
              <div className="rounded border p-2 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span>Latest report</span>
                  <Badge variant={d.parity_reports[0].risk_level === "blocking" ? "destructive" : "outline"}>
                    {d.parity_reports[0].risk_level}
                  </Badge>
                </div>
                <div className="text-muted-foreground">{d.parity_reports[0].summary}</div>
                {Array.isArray(d.parity_reports[0].blocking_issues) &&
                  d.parity_reports[0].blocking_issues.length > 0 && (
                    <ul className="list-disc pl-4">
                      {d.parity_reports[0].blocking_issues.map((b: string) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                <div className="text-muted-foreground">
                  {new Date(d.parity_reports[0].generated_at).toLocaleString()} · target={d.parity_reports[0].target_ref}
                </div>
              </div>
            )}
            <div>Reports: <Badge variant="outline">{d.parity_reports.length}</Badge> · Signed contracts: <Badge variant="outline">{d.contracts.length}</Badge></div>
            {h.consent_signed_at ? (
              <div className="text-xs text-muted-foreground">
                Consent v{h.consent_terms_version} signed {new Date(h.consent_signed_at).toLocaleString()}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No consent on file yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Github className="h-4 w-4" /> GitHub App access (G9)</CardTitle>
            <CardDescription>Confirm the Aurixa App can still reach {h.clones?.github_owner ?? "the clone"}/{h.clones?.github_repo ?? "repo"}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Button size="sm" variant="outline" onClick={() => ghCheck.mutate()} disabled={ghCheck.isPending}>
              {ghCheck.isPending ? "Checking…" : "Verify installation access"}
            </Button>
            {gh && (
              <div className="rounded border p-2 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span>{gh.github_owner}/{gh.github_repo}</span>
                  <Badge variant={gh.ok ? "outline" : "destructive"}>{gh.ok ? "ok" : "blocked"}</Badge>
                </div>
                <div className="text-muted-foreground">
                  Selection: {gh.repository_selection ?? "—"} · repo: {gh.repo_accessible == null ? "—" : gh.repo_accessible ? "reachable" : "unreachable"} · contents:write: {gh.contents_write == null ? "—" : gh.contents_write ? "yes" : "no"}
                </div>
                {gh.message && <div>{gh.message}</div>}
                {gh.hint && <div className="text-muted-foreground">Hint: {gh.hint}</div>}
              </div>
            )}
          </CardContent>
        </Card>

      </div>


      <ClientPortalInvitesCard handoffId={handoffId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event log</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1 max-h-96 overflow-auto">
            {d.events.map((e: any) => (
              <li key={e.id} className="border-b py-1 flex justify-between">
                <span><strong>{e.kind}</strong> {e.details && JSON.stringify(e.details)}</span>
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
            {d.events.length === 0 && <li className="text-muted-foreground">no events</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// G11 — Client onboarding portal invites (mint / list / revoke).
function ClientPortalInvitesCard({ handoffId }: { handoffId: string }) {
  const qc = useQueryClient();
  const [ttlHours, setTtlHours] = useState(72);
  const [termsVersion, setTermsVersion] = useState("v1.0");
  const [termsBody, setTermsBody] = useState(
    "Aurixa Systems Data Processing Addendum — client-owned Supabase handoff.\n\n" +
      "By signing below, you authorise Aurixa Systems to use the personal access " +
      "token you provide to create a new Supabase project inside your organisation, " +
      "replicate schema/storage/edge configuration from your Aurixa clone, migrate " +
      "your data into that project, and rotate secrets so the clone routes to the " +
      "new backend. You may revoke the token from your Supabase dashboard once the " +
      "handoff completes.",
  );
  const [regions, setRegions] = useState("");
  const [plans, setPlans] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<string | null>(null);

  const invites = useQuery({
    queryKey: ["handoff", handoffId, "invites"],
    queryFn: () => listHandoffInvites({ data: { handoff_id: handoffId } }),
    refetchInterval: 30000,
  });

  const mint = useMutation({
    mutationFn: () =>
      createHandoffInvite({
        data: {
          handoff_id: handoffId,
          ttl_hours: ttlHours,
          terms_version: termsVersion,
          terms_body: termsBody,
          region_allowlist: regions
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean),
          plan_allowlist: plans
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId, "invites"] });
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      setFreshToken(r.token);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setFreshLink(`${origin}/clients/handoff/${r.token}`);
      toast.success("Invite minted — copy the link now, it won't be shown again.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to mint invite"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeHandoffInvite({ data: { id, reason: "manual_revoke" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId, "invites"] });
      toast.success("Invite revoked");
    },
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <LinkIcon className="h-4 w-4" /> Client onboarding portal (G11)
        </CardTitle>
        <CardDescription>
          Mint a single-use link for the client to submit their Supabase org
          details, personal access token, and DPA signature — no Mission Control
          account needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Terms version</Label>
            <Input value={termsVersion} onChange={(e) => setTermsVersion(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Link TTL (hours)</Label>
            <Input
              type="number"
              min={1}
              max={720}
              value={ttlHours}
              onChange={(e) => setTtlHours(Math.max(1, Number(e.target.value) || 72))}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Terms body</Label>
            <Textarea
              rows={6}
              value={termsBody}
              onChange={(e) => setTermsBody(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Allowed regions (comma-separated, optional)</Label>
            <Input
              value={regions}
              onChange={(e) => setRegions(e.target.value)}
              placeholder="ap-southeast-2, us-east-1"
            />
          </div>
          <div className="space-y-1">
            <Label>Allowed plans (comma-separated, optional)</Label>
            <Input
              value={plans}
              onChange={(e) => setPlans(e.target.value)}
              placeholder="pro, team"
            />
          </div>
        </div>
        <Button size="sm" onClick={() => mint.mutate()} disabled={mint.isPending}>
          {mint.isPending ? "Minting…" : "Mint invite link"}
        </Button>

        {freshLink && (
          <div className="rounded border border-primary/40 bg-primary/5 p-3 text-xs space-y-2">
            <div className="font-medium">Copy this link now — it will not be shown again.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-[11px]">{freshLink}</code>
              <Button size="sm" variant="outline" onClick={() => copy(freshLink)}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="text-muted-foreground">Token prefix: {freshToken?.slice(0, 14)}…</div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Invite history</div>
          <ul className="space-y-1">
            {(invites.data?.invites ?? []).map((inv: any) => {
              const status = inv.revoked_at
                ? "revoked"
                : inv.consumed_at
                  ? "consumed"
                  : new Date(inv.expires_at).getTime() < Date.now()
                    ? "expired"
                    : "active";
              return (
                <li key={inv.id} className="flex items-center justify-between border-b py-1 text-xs">
                  <div className="space-y-0.5">
                    <div>
                      <code>{inv.token_prefix}…</code> · terms {inv.terms_version}
                    </div>
                    <div className="text-muted-foreground">
                      expires {new Date(inv.expires_at).toLocaleString()}
                      {inv.consumed_at ? ` · consumed ${new Date(inv.consumed_at).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={status === "active" ? "outline" : "secondary"}>{status}</Badge>
                    {status === "active" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revoke.mutate(inv.id)}
                        disabled={revoke.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
            {(invites.data?.invites ?? []).length === 0 && (
              <li className="text-muted-foreground">No invites minted yet.</li>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
