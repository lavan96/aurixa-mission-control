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
  planStandardRotations,
  executeSecretRotation,
  markSecretRotation,
  requestCostExport,
  runParityDryRun,
  runCutoverOrchestrator,
  rollbackHandoffCutover,

  replicateHandoffAuthUsers,
  replicateHandoffStorageObjects,

  HANDOFF_STATE_ORDER,
} from "@/lib/handoffs.functions";



import {
  createHandoffInvite,
  listHandoffInvites,
  revokeHandoffInvite,
} from "@/lib/handoff-invites.functions";
import { verifyCloneRepoGithubAccess, type CloneGithubAccessRow } from "@/lib/clone-github-access.functions";
import { getHandoffContractDocumentUrl } from "@/lib/handoff-terms.functions";
import { ArrowRight, Camera, KeyRound, FileDown, ScrollText, ShieldCheck, Github, Link as LinkIcon, Copy, Trash2, FileText, Users } from "lucide-react";

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
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false && r.error === "rotations_incomplete") {
        toast.error(
          `Blocked — ${r.outstanding?.length ?? 0} rotation(s) not rotated/skipped`,
        );
        return;
      }
      if (r?.ok === false) {
        toast.error(r.error ?? "Failed");
        return;
      }
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

  // G14 — one-click plan of the default rotation set.
  const planRotations = useMutation({
    mutationFn: () => planStandardRotations({ data: { handoff_id: handoffId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      toast.success(`Planned ${r.inserted ?? 0} rotation(s)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Plan failed"),
  });

  // G14 — execute a single rotation via its executor.
  const runRotation = useMutation({
    mutationFn: (id: string) => executeSecretRotation({ data: { id } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false) return toast.error(r.error ?? "Failed");
      if (r.status === "rotated") toast.success("Rotated");
      else if (r.status === "in_progress") toast.info("Awaiting external evidence");
      else toast.error(`Rotation ${r.status}: ${r.error ?? ""}`);
    },
  });

  // G14 — manual acknowledge (out-of-band rotate).
  const ackRotation = useMutation({
    mutationFn: (v: { id: string; status: "rotated" | "skipped" | "failed"; evidence?: string }) =>
      markSecretRotation({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      toast.success("Rotation acknowledged");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  // G15 — cutover orchestrator: drives cutover_in_progress → complete or
  // rolled_back/failed by walking rotations in canonical order.
  const orchestrate = useMutation({
    mutationFn: () => runCutoverOrchestrator({ data: { handoff_id: handoffId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false) {
        if (r.error === "rotation_failed") {
          toast.error(`Cutover aborted → ${r.transitioned_to}`);
        } else if (r.error === "wrong_state") {
          toast.error(`Cannot orchestrate from state: ${r.state}`);
        } else {
          toast.error(r.error ?? "Orchestrator failed");
        }
        return;
      }
      if (r?.complete) toast.success(`Cutover complete · ${r.results?.length ?? 0} rotation(s)`);
      else if (r?.halted === "awaiting_evidence")
        toast.info(`Halted at ${r.target} · supply evidence and re-run`);
      else if (r?.halted === "outstanding")
        toast.info(`Halted · ${r.outstanding?.length ?? 0} rotation(s) still open`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Orchestrator failed"),
  });

  // G18 — cutover rollback: reverses landed rotations in reverse order and
  // flags the pinned snapshot for restore.
  const rollback = useMutation({
    mutationFn: () => rollbackHandoffCutover({ data: { handoff_id: handoffId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false && r?.error) {
        toast.error(r.error === "wrong_state" ? `Cannot roll back from ${r.state}` : r.error);
        return;
      }
      toast.success(
        `Rollback → ${r?.final_state} · ${r?.rolled_back ?? 0} reversed` +
          (r?.manual_required ? ` · ${r.manual_required} manual` : "") +
          (r?.failed ? ` · ${r.failed} failed` : "") +
          (r?.snapshot_restore_requested ? " · snapshot restore requested" : ""),
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Rollback failed"),
  });


  // G16 — auth users replication (twin_ready / data_syncing).
  const authReplicate = useMutation({
    mutationFn: () => replicateHandoffAuthUsers({ data: { handoff_id: handoffId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false) {
        toast.error(`Auth replication failed: ${r.error}${r.detail ? ` — ${r.detail}` : ""}`);
        return;
      }
      const msg = `Auth replicated · scanned ${r.scanned} · imported ${r.imported} · skipped ${r.skipped}${r.failed ? ` · failed ${r.failed}` : ""}${r.truncated ? " · truncated" : ""}${r.advanced ? " · advanced → data_syncing" : ""}`;
      if (r.failed > 0) toast.warning(msg);
      else toast.success(msg);
    },
    onError: (e: any) => toast.error(e?.message ?? "Auth replication failed"),
  });

  // G17 — storage objects replication (data_syncing).
  const storageReplicate = useMutation({
    mutationFn: () => replicateHandoffStorageObjects({ data: { handoff_id: handoffId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["handoff", handoffId] });
      if (r?.ok === false) {
        toast.error(`Storage replication failed: ${r.error}${r.detail ? ` — ${r.detail}` : ""}`);
        return;
      }
      const totCopied = (r.buckets ?? []).reduce((n: number, b: any) => n + b.objects_copied, 0);
      const totBytes = (r.buckets ?? []).reduce((n: number, b: any) => n + b.bytes_copied, 0);
      const msg = `Storage · ${r.buckets?.length ?? 0} buckets · copied ${totCopied} · ${(totBytes / 1024 / 1024).toFixed(1)} MB${r.incomplete ? ` · incomplete (${r.budget_exhausted})` : " · complete"}${r.advanced ? " · advanced" : ""}`;
      if (r.incomplete) toast.info(msg);
      else toast.success(msg);
    },
    onError: (e: any) => toast.error(e?.message ?? "Storage replication failed"),
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
            <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Secret rotations (E5 · G14)</CardTitle>
            <CardDescription>
              Plan and execute the cutover rotation set. `complete` is blocked
              until every row is <em>rotated</em> or <em>skipped</em>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => planRotations.mutate()} disabled={planRotations.isPending}>
                {planRotations.isPending ? "Planning…" : "Plan default rotation set"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => orchestrate.mutate()}
                disabled={orchestrate.isPending}
                title="G15 — walk rotations in canonical order and drive the state machine"
              >
                {orchestrate.isPending ? "Orchestrating…" : "Run cutover orchestrator (G15)"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm("Roll back this cutover? Reverses landed rotations and requests snapshot restore.")) rollback.mutate();
                }}
                disabled={rollback.isPending}
                title="G18 — reverse landed rotations and flag the pinned snapshot for restore"
              >
                {rollback.isPending ? "Rolling back…" : "Roll back cutover (G18)"}
              </Button>

              {(["clone_repo", "cloudflare", "stripe_endpoint", "github_webhook", "edge_function_env"] as const).map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => rotate.mutate(t)}>+ {t}</Button>
              ))}
            </div>

            <ul className="space-y-2">
              {d.rotations.map((r: any) => {
                const evidence = (r.metadata as any)?.manual_ack?.evidence
                  ?? (r.metadata as any)?.last_execution?.rotated_via
                  ?? (r.metadata as any)?.hint;
                return (
                  <li key={r.id} className="rounded border p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs truncate">{r.target} · {r.key_ref}</div>
                        {evidence && <div className="text-xs text-muted-foreground truncate">{evidence}</div>}
                        {r.error && <div className="text-xs text-destructive">{r.error}</div>}
                      </div>
                      <Badge variant={r.status === "rotated" ? "outline" : r.status === "failed" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                    </div>
                    {r.status !== "rotated" && r.status !== "skipped" && (
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => runRotation.mutate(r.id)} disabled={runRotation.isPending}>
                          Execute
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const ev = window.prompt("Evidence (URL or note) for rotated:");
                          if (ev) ackRotation.mutate({ id: r.id, status: "rotated", evidence: ev });
                        }}>Mark rotated</Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const ev = window.prompt("Reason to skip:");
                          if (ev) ackRotation.mutate({ id: r.id, status: "skipped", evidence: ev });
                        }}>Skip</Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const ev = window.prompt("Failure note:");
                          if (ev) ackRotation.mutate({ id: r.id, status: "failed", evidence: ev });
                        }}>Mark failed</Button>
                      </div>
                    )}
                  </li>
                );
              })}
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
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Auth users replication (G16)
            </CardTitle>
            <CardDescription>
              Copy <code>auth.users</code> from the source project into the
              client-owned twin. Preserves user id, bcrypt password hash,
              confirmation timestamps, and metadata so existing users can
              sign in against the twin without resetting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="text-muted-foreground">
              Runs from <code>twin_ready</code>, <code>data_syncing</code>, or
              <code> cutover_scheduled</code>. Idempotent: existing user ids
              on the target are skipped.
            </div>
            <Button
              size="sm"
              onClick={() => authReplicate.mutate()}
              disabled={authReplicate.isPending}
            >
              {authReplicate.isPending ? "Replicating…" : "Replicate auth users"}
            </Button>
            {authReplicate.data && (
              <div className="mt-2 rounded border p-2 text-xs">
                <div>
                  scanned <b>{authReplicate.data.scanned}</b> · imported{" "}
                  <b>{authReplicate.data.imported}</b> · skipped{" "}
                  <b>{authReplicate.data.skipped}</b> · failed{" "}
                  <b>{authReplicate.data.failed}</b>
                  {authReplicate.data.truncated ? " · truncated" : ""}
                </div>
                {authReplicate.data.errors?.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer">
                      {authReplicate.data.errors.length} error sample(s)
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {authReplicate.data.errors.map((e: any) => (
                        <li key={e.user_id} className="font-mono">
                          {e.email ?? e.user_id}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileDown className="h-4 w-4" /> Storage objects replication (G17)
            </CardTitle>
            <CardDescription>
              Bulk-copy every object in every storage bucket from the source
              project into the client-owned twin. Idempotent (objects already
              on target are skipped) and resumable — re-invoke until every
              bucket reports <code>complete</code>. Paced by a per-invocation
              budget of ~400 objects / 400&nbsp;MB / 45&nbsp;s.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Button
              size="sm"
              onClick={() => storageReplicate.mutate()}
              disabled={storageReplicate.isPending}
            >
              {storageReplicate.isPending ? "Replicating…" : "Run storage replication"}
            </Button>
            {(d.storage_replications?.length ?? 0) > 0 && (
              <div className="mt-2 rounded border p-2 text-xs">
                <table className="w-full text-left">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pr-2">bucket</th>
                      <th className="pr-2">status</th>
                      <th className="pr-2">copied</th>
                      <th className="pr-2">skipped</th>
                      <th className="pr-2">failed</th>
                      <th className="pr-2">bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.storage_replications.map((r: any) => (
                      <tr key={r.bucket_id} className="border-t">
                        <td className="pr-2 font-mono">{r.bucket_id}</td>
                        <td className="pr-2">
                          <Badge variant={r.status === "complete" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="pr-2">{r.objects_copied}</td>
                        <td className="pr-2">{r.objects_skipped}</td>
                        <td className="pr-2">{r.objects_failed}</td>
                        <td className="pr-2">{(Number(r.bytes_copied ?? 0) / 1024 / 1024).toFixed(1)} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {storageReplicate.data?.incomplete && (
              <div className="text-xs text-muted-foreground">
                Budget exhausted ({storageReplicate.data.budget_exhausted}) — re-run to continue.
              </div>
            )}
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
            {d.contracts.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                <div className="text-xs font-medium">Signed records (G13)</div>
                {d.contracts.map((c: any) => (
                  <div key={c.id} className="rounded border p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">v{c.version}</span>
                      <span className="text-muted-foreground">
                        {c.signed_at ? new Date(c.signed_at).toLocaleString() : "—"}
                      </span>
                    </div>
                    <div className="text-muted-foreground">{c.signed_by_name} · {c.signed_by_email}</div>
                    {c.signature_bundle_sha256 && (
                      <div className="font-mono break-all text-[10px]">
                        bundle: {c.signature_bundle_sha256}
                      </div>
                    )}
                    <div className="text-muted-foreground">
                      Snapshots at signing:{" "}
                      <Badge variant="outline">
                        {Array.isArray(c.snapshot_manifest) ? c.snapshot_manifest.length : 0}
                      </Badge>
                    </div>
                    {c.document_storage_path && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const res = await getHandoffContractDocumentUrl({
                              data: { contract_id: c.id, expires_in: 300 },
                            });
                            if (res?.ok && res.url) window.open(res.url, "_blank");
                            else toast.error("No document attached");
                          } catch (e: any) {
                            toast.error(e?.message ?? "Failed");
                          }
                        }}
                      >
                        <FileText className="h-3 w-3 mr-1" /> Download signed doc
                      </Button>
                    )}
                  </div>
                ))}
              </div>
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
