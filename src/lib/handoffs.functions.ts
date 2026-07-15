// @ts-nocheck
// E1 — Handoff state machine + event log.
// E2, E4, E5, E7, E8 record scaffolding lives here as thin CRUD; the actual
// compute (parity diff, snapshot capture, secret rotation execution, cost
// export generation) is wired in round 2 alongside gap resolution.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/role-middleware";

const STATE_ORDER = [
  "draft",
  "dry_run_ready",
  "awaiting_client_consent",
  "snapshot_pending",
  "snapshot_ready",
  "twin_provisioning",
  "twin_ready",
  "data_syncing",
  "cutover_scheduled",
  "cutover_in_progress",
  "complete",
] as const;
const TERMINAL_STATES = new Set(["complete", "rolled_back", "failed", "canceled"]);
const ALL_STATES = [...STATE_ORDER, "rolled_back", "failed", "canceled"] as const;

const createSchema = z.object({
  clone_id: z.string().uuid(),
  backend_id: z.string().uuid().nullable().optional(),
  client_account_id: z.string().uuid().nullable().optional(),
  policy_id: z.string().uuid().nullable().optional(),
  path: z.enum(["rebuild_twin", "enterprise_transfer"]).default("rebuild_twin"),
  target_region: z.string().nullable().optional(),
  target_plan_tier: z.string().nullable().optional(),
  metadata: z.record(z.any()).optional(),
});

export const listHandoffs = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clone_handoffs")
      .select("*, clones(id, name, slug)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getHandoff = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [handoff, events, snapshots, parity, rotations, contracts, exports_] =
      await Promise.all([
        context.supabase
          .from("clone_handoffs")
          .select("*, clones(id, name, slug), client_supabase_accounts(id, owner_email, org_slug)")
          .eq("id", data.id)
          .maybeSingle(),
        context.supabase
          .from("handoff_events")
          .select("*")
          .eq("handoff_id", data.id)
          .order("created_at", { ascending: false })
          .limit(200),
        context.supabase
          .from("handoff_snapshots")
          .select("*")
          .eq("handoff_id", data.id)
          .order("created_at", { ascending: false }),
        context.supabase
          .from("handoff_parity_reports")
          .select("*")
          .eq("handoff_id", data.id)
          .order("generated_at", { ascending: false })
          .limit(10),
        context.supabase
          .from("handoff_secret_rotations")
          .select("*")
          .eq("handoff_id", data.id)
          .order("created_at", { ascending: false }),
        context.supabase
          .from("handoff_contracts")
          .select("*")
          .eq("handoff_id", data.id)
          .order("created_at", { ascending: false }),
        context.supabase
          .from("handoff_cost_exports")
          .select("*")
          .eq("handoff_id", data.id)
          .order("generated_at", { ascending: false }),
      ]);
    if (handoff.error) throw handoff.error;
    return {
      handoff: handoff.data,
      events: events.data ?? [],
      snapshots: snapshots.data ?? [],
      parity_reports: parity.data ?? [],
      rotations: rotations.data ?? [],
      contracts: contracts.data ?? [],
      cost_exports: exports_.data ?? [],
    };
  });

export const createHandoff = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("clone_handoffs")
      .insert({
        clone_id: data.clone_id,
        backend_id: data.backend_id ?? null,
        client_account_id: data.client_account_id ?? null,
        policy_id: data.policy_id ?? null,
        path: data.path,
        state: "draft",
        target_region: data.target_region ?? null,
        target_plan_tier: data.target_plan_tier ?? null,
        metadata: data.metadata ?? {},
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    await context.supabase.from("handoff_events").insert({
      handoff_id: row.id,
      kind: "handoff.created",
      actor_user_id: context.userId,
      details: { path: data.path },
    });
    return { ok: true as const, id: row.id };
  });

export const transitionHandoff = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        to_state: z.enum(ALL_STATES),
        note: z.string().nullable().optional(),
        error: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: readErr } = await context.supabase
      .from("clone_handoffs")
      .select("state")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return { ok: false as const, error: "not_found" };
    if (TERMINAL_STATES.has(current.state) && current.state !== data.to_state) {
      return { ok: false as const, error: "terminal_state" };
    }
    // G14 — block `complete` until every queued rotation is rotated/skipped.
    if (data.to_state === "complete") {
      const { data: outstanding } = await context.supabase
        .from("handoff_secret_rotations")
        .select("id, target, key_ref, status")
        .eq("handoff_id", data.id)
        .not("status", "in", "(rotated,skipped)");
      if (outstanding && outstanding.length > 0) {
        return {
          ok: false as const,
          error: "rotations_incomplete",
          outstanding,
        };
      }
    }
    const patch: Record<string, unknown> = { state: data.to_state };

    if (data.to_state === "twin_provisioning" || data.to_state === "snapshot_pending") {
      patch.initiated_at = new Date().toISOString();
    }
    if (data.to_state === "complete" || data.to_state === "rolled_back" || data.to_state === "failed" || data.to_state === "canceled") {
      patch.completed_at = new Date().toISOString();
    }
    if (data.error) patch.error = data.error;
    const { error: updErr } = await context.supabase
      .from("clone_handoffs")
      .update(patch)
      .eq("id", data.id);
    if (updErr) throw updErr;
    await context.supabase.from("handoff_events").insert({
      handoff_id: data.id,
      kind: "handoff.transitioned",
      actor_user_id: context.userId,
      details: { from: current.state, to: data.to_state, note: data.note ?? null, error: data.error ?? null },
    });
    return { ok: true as const, from: current.state, to: data.to_state };
  });

export const logHandoffEvent = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        handoff_id: z.string().uuid(),
        kind: z.string().min(1),
        details: z.record(z.any()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("handoff_events").insert({
      handoff_id: data.handoff_id,
      kind: data.kind,
      actor_user_id: context.userId,
      details: data.details ?? {},
    });
    if (error) throw error;
    return { ok: true as const };
  });

// E4 — record a snapshot intent (physical capture is round 2).
export const recordHandoffSnapshot = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        handoff_id: z.string().uuid(),
        kind: z.enum(["pitr_pin", "pg_dump", "storage_export", "auth_export"]),
        storage_path: z.string().nullable().optional(),
        retention_days: z.number().int().positive().max(365).default(30),
        metadata: z.record(z.any()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const expires = new Date(Date.now() + data.retention_days * 86_400_000).toISOString();
    const { data: row, error } = await context.supabase
      .from("handoff_snapshots")
      .insert({
        handoff_id: data.handoff_id,
        kind: data.kind,
        storage_path: data.storage_path ?? null,
        retention_expires_at: expires,
        status: "pending",
        metadata: data.metadata ?? {},
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true as const, id: row.id };
  });

// E5 — enqueue a secret rotation row (executor lives in round 2).
export const recordSecretRotation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        handoff_id: z.string().uuid(),
        target: z.enum([
          "clone_repo",
          "cloudflare",
          "stripe_endpoint",
          "github_webhook",
          "webhook_consumer",
          "edge_function_env",
          "other",
        ]),
        key_ref: z.string().min(1),
        metadata: z.record(z.any()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("handoff_secret_rotations")
      .insert({
        handoff_id: data.handoff_id,
        target: data.target,
        key_ref: data.key_ref,
        status: "pending",
        metadata: data.metadata ?? {},
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true as const, id: row.id };
  });

// E7 — record a signed DPA/contract. PDF generation + storage upload are
// round-2 work; here we accept an already-hashed terms body.
export const recordHandoffContract = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        handoff_id: z.string().uuid(),
        version: z.string().min(1),
        terms_hash: z.string().min(1),
        signed_by_name: z.string().min(1),
        signed_by_email: z.string().email(),
        signed_at: z.string().datetime().optional(),
        ip_address: z.string().nullable().optional(),
        user_agent: z.string().nullable().optional(),
        pdf_storage_path: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("handoff_contracts")
      .insert({
        handoff_id: data.handoff_id,
        version: data.version,
        terms_hash: data.terms_hash,
        signed_by_name: data.signed_by_name,
        signed_by_email: data.signed_by_email,
        signed_at: data.signed_at ?? new Date().toISOString(),
        ip_address: data.ip_address ?? null,
        user_agent: data.user_agent ?? null,
        pdf_storage_path: data.pdf_storage_path ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    await context.supabase
      .from("clone_handoffs")
      .update({
        consent_signed_at: new Date().toISOString(),
        consent_terms_version: data.version,
      })
      .eq("id", data.handoff_id);
    await context.supabase.from("handoff_events").insert({
      handoff_id: data.handoff_id,
      kind: "handoff.consent_signed",
      actor_user_id: context.userId,
      details: { version: data.version, signer: data.signed_by_email },
    });
    return { ok: true as const, id: row.id };
  });

// E8 — request a usage-history export for the client. Actual CSV generation
// runs asynchronously in round 2; this row is the promise + audit surface.
export const requestCostExport = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        handoff_id: z.string().uuid(),
        period_start: z.string().datetime(),
        period_end: z.string().datetime(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("handoff_cost_exports")
      .insert({
        handoff_id: data.handoff_id,
        period_start: data.period_start,
        period_end: data.period_end,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true as const, id: row.id };
  });

// G1 — Compute a schema/policies/functions/extensions parity report between
// prime backend and the clone's target backend. On success writes a row to
// handoff_parity_reports; when no blocking issues are found, auto-advances
// the handoff to `dry_run_ready`.
export const runParityDryRun = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => z.object({ handoff_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: handoff, error: hErr } = await context.supabase
      .from("clone_handoffs")
      .select("id, state, clone_id, backend_id")
      .eq("id", data.handoff_id)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!handoff) return { ok: false as const, error: "not_found" };

    // Resolve target project ref via clone_backends.
    let backendQuery = context.supabase
      .from("clone_backends")
      .select("supabase_project_ref, status")
      .eq("clone_id", handoff.clone_id)
      .not("supabase_project_ref", "is", null)
      .not("status", "in", "(failed,deleted,destroyed)")
      .order("created_at", { ascending: false })
      .limit(1);
    if (handoff.backend_id) {
      backendQuery = context.supabase
        .from("clone_backends")
        .select("supabase_project_ref, status")
        .eq("id", handoff.backend_id)
        .limit(1);
    }
    const { data: backend, error: bErr } = await backendQuery.maybeSingle();
    if (bErr) throw bErr;
    if (!backend?.supabase_project_ref) {
      return { ok: false as const, error: "no_target_backend" };
    }

    // Compute parity (server-only module — imported inside the handler so it
    // never leaks into the client bundle).
    const { computeParity, getPrimeProjectRef } = await import(
      "@/server/handoff-parity.server"
    );
    const primeRef = getPrimeProjectRef();
    const parity = await computeParity(primeRef, backend.supabase_project_ref);

    const { data: row, error: insErr } = await context.supabase
      .from("handoff_parity_reports")
      .insert({
        handoff_id: data.handoff_id,
        prime_ref: parity.prime_ref,
        target_ref: parity.target_ref,
        risk_level: parity.risk_level,
        tables_diff: parity.tables_diff,
        policies_diff: parity.policies_diff,
        functions_diff: parity.functions_diff,
        buckets_diff: parity.buckets_diff,
        cron_diff: parity.cron_diff,
        edge_functions_diff: parity.edge_functions_diff,
        secrets_diff: parity.secrets_diff,
        auth_diff: parity.auth_config_diff,
        extensions_diff: parity.extensions_diff,
        blocking_issues: parity.blocking_issues,
        summary: parity.summary,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    await context.supabase.from("handoff_events").insert({
      handoff_id: data.handoff_id,
      kind: "handoff.parity_computed",
      actor_user_id: context.userId,
      details: {
        parity_id: row.id,
        risk_level: parity.risk_level,
        blocking_count: parity.blocking_issues.length,
        summary: parity.summary,
      },
    });

    // Auto-advance draft → dry_run_ready when clean.
    let advanced = false;
    if (handoff.state === "draft" && parity.blocking_issues.length === 0) {
      const { error: updErr } = await context.supabase
        .from("clone_handoffs")
        .update({ state: "dry_run_ready" })
        .eq("id", data.handoff_id);
      if (!updErr) {
        advanced = true;
        await context.supabase.from("handoff_events").insert({
          handoff_id: data.handoff_id,
          kind: "handoff.transitioned",
          actor_user_id: context.userId,
          details: { from: "draft", to: "dry_run_ready", note: "auto: parity clean" },
        });
      }
    }

    return {
      ok: true as const,
      parity_id: row.id,
      risk_level: parity.risk_level,
      blocking_issues: parity.blocking_issues,
      advanced,
    };
  });

export const HANDOFF_STATE_ORDER = STATE_ORDER;

// ---------------------------------------------------------------------------
// G14 — Secret rotation cutover executor.
// ---------------------------------------------------------------------------

// Enqueue the default rotation plan for a handoff. Idempotent: rows are keyed
// by (handoff_id, target, key_ref).
export const planStandardRotations = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => z.object({ handoff_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { DEFAULT_ROTATION_PLAN } = await import("@/server/handoff-rotations.server");
    const { data: existing } = await context.supabase
      .from("handoff_secret_rotations")
      .select("target, key_ref")
      .eq("handoff_id", data.handoff_id);
    const seen = new Set(
      (existing ?? []).map((r: any) => `${r.target}::${r.key_ref}`),
    );
    const rows = DEFAULT_ROTATION_PLAN.filter(
      (p) => !seen.has(`${p.target}::${p.key_ref}`),
    ).map((p) => ({
      handoff_id: data.handoff_id,
      target: p.target,
      key_ref: p.key_ref,
      status: "pending" as const,
      metadata: { hint: p.hint },
    }));
    if (rows.length === 0) {
      return { ok: true as const, inserted: 0, skipped: DEFAULT_ROTATION_PLAN.length };
    }
    const { error } = await context.supabase
      .from("handoff_secret_rotations")
      .insert(rows);
    if (error) throw error;
    await context.supabase.from("handoff_events").insert({
      handoff_id: data.handoff_id,
      kind: "handoff.rotations_planned",
      actor_user_id: context.userId,
      details: { inserted: rows.length },
    });
    return { ok: true as const, inserted: rows.length };
  });

// Execute a queued rotation. Advances pending → in_progress → rotated/failed.
export const executeSecretRotation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error: rErr } = await context.supabase
      .from("handoff_secret_rotations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!row) return { ok: false as const, error: "not_found" };
    if (row.status === "rotated" || row.status === "skipped") {
      return { ok: true as const, idempotent: true, status: row.status };
    }
    await context.supabase
      .from("handoff_secret_rotations")
      .update({ status: "in_progress" })
      .eq("id", data.id);

    const { executeRotation } = await import("@/server/handoff-rotations.server");
    const outcome = await executeRotation(row);

    const patch: Record<string, unknown> = {
      status: outcome.status,
      metadata: {
        ...(row.metadata ?? {}),
        last_execution: {
          at: new Date().toISOString(),
          actor: context.userId,
          ...outcome.audit,
        },
        // Scrub the raw secret_value once the API call succeeded — never let
        // a plaintext secret loiter in the audit row.
        ...(outcome.status === "rotated" && (row.metadata as any)?.secret_value
          ? { secret_value: undefined }
          : {}),
      },
      error: outcome.error ?? null,
    };
    if (outcome.status === "rotated") patch.rotated_at = new Date().toISOString();
    // If secret_value was scrubbed, delete key explicitly.
    if (outcome.status === "rotated" && (row.metadata as any)?.secret_value) {
      const cleaned = { ...(row.metadata as any) };
      delete cleaned.secret_value;
      cleaned.last_execution = (patch.metadata as any).last_execution;
      patch.metadata = cleaned;
    }
    const { error: uErr } = await context.supabase
      .from("handoff_secret_rotations")
      .update(patch)
      .eq("id", data.id);
    if (uErr) throw uErr;
    await context.supabase.from("handoff_events").insert({
      handoff_id: row.handoff_id,
      kind: `handoff.rotation_${outcome.status}`,
      actor_user_id: context.userId,
      details: {
        rotation_id: data.id,
        target: row.target,
        key_ref: row.key_ref,
        error: outcome.error ?? null,
      },
    });
    return { ok: true as const, status: outcome.status, error: outcome.error ?? null };
  });

// Manual override — used when the physical rotate happened out-of-band.
export const markSecretRotation = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["rotated", "skipped", "failed"]),
        evidence: z.string().min(1).max(2000).optional(),
        error: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("handoff_secret_rotations")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false as const, error: "not_found" };
    const patch: Record<string, unknown> = {
      status: data.status,
      error: data.error ?? null,
      metadata: {
        ...(row.metadata ?? {}),
        manual_ack: {
          at: new Date().toISOString(),
          actor: context.userId,
          evidence: data.evidence ?? null,
          status: data.status,
        },
      },
    };
    if (data.status === "rotated" || data.status === "skipped") {
      patch.rotated_at = new Date().toISOString();
    }
    const { error: uErr } = await context.supabase
      .from("handoff_secret_rotations")
      .update(patch)
      .eq("id", data.id);
    if (uErr) throw uErr;
    await context.supabase.from("handoff_events").insert({
      handoff_id: row.handoff_id,
      kind: `handoff.rotation_marked_${data.status}`,
      actor_user_id: context.userId,
      details: {
        rotation_id: data.id,
        target: row.target,
        key_ref: row.key_ref,
        evidence: data.evidence ?? null,
      },
    });
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// G15 — Cutover orchestrator.
//
// Walks queued rotations in canonical order, executes each via
// `executeRotation`, and drives the handoff state machine:
//   twin_ready | data_syncing | cutover_scheduled → cutover_in_progress
//   all rotations rotated/skipped                 → complete
//   any rotation failed                           → rolled_back (if
//                                                   rollback_snapshot_id set)
//                                                   otherwise failed
// Bookkeeping targets that come back `in_progress` (awaiting operator
// evidence) are treated as soft-stops: the orchestrator halts without
// failing so the operator can supply evidence and re-run.
// ---------------------------------------------------------------------------

const ROTATION_PRIORITY: Record<string, number> = {
  stripe_endpoint: 10,
  github_webhook: 20,
  cloudflare: 30,
  clone_repo: 40,
  edge_function_env: 50,
  webhook_consumer: 60,
  other: 70,
};

export const runCutoverOrchestrator = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input) => z.object({ handoff_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: handoff, error: hErr } = await context.supabase
      .from("clone_handoffs")
      .select("id, state, rollback_snapshot_id")
      .eq("id", data.handoff_id)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!handoff) return { ok: false as const, error: "not_found" };

    const CUTOVER_ENTRY = new Set([
      "twin_ready",
      "data_syncing",
      "cutover_scheduled",
      "cutover_in_progress",
    ]);
    if (!CUTOVER_ENTRY.has(handoff.state)) {
      return { ok: false as const, error: "wrong_state", state: handoff.state };
    }

    // Enter cutover_in_progress.
    if (handoff.state !== "cutover_in_progress") {
      await context.supabase
        .from("clone_handoffs")
        .update({ state: "cutover_in_progress", initiated_at: new Date().toISOString() })
        .eq("id", data.handoff_id);
      await context.supabase.from("handoff_events").insert({
        handoff_id: data.handoff_id,
        kind: "handoff.cutover_started",
        actor_user_id: context.userId,
        details: { from: handoff.state },
      });
    }

    const { data: rows, error: rErr } = await context.supabase
      .from("handoff_secret_rotations")
      .select("*")
      .eq("handoff_id", data.handoff_id);
    if (rErr) throw rErr;
    const all = rows ?? [];
    if (all.length === 0) {
      return { ok: false as const, error: "no_rotations_planned" };
    }

    const pending = all
      .filter((r: any) => r.status !== "rotated" && r.status !== "skipped")
      .sort(
        (a: any, b: any) =>
          (ROTATION_PRIORITY[a.target] ?? 99) - (ROTATION_PRIORITY[b.target] ?? 99),
      );

    const { executeRotation } = await import("@/server/handoff-rotations.server");
    const results: Array<{
      id: string;
      target: string;
      key_ref: string;
      status: string;
      error?: string | null;
    }> = [];

    for (const row of pending) {
      await context.supabase
        .from("handoff_secret_rotations")
        .update({ status: "in_progress" })
        .eq("id", row.id);
      const outcome = await executeRotation(row);
      const patch: Record<string, unknown> = {
        status: outcome.status,
        error: outcome.error ?? null,
        metadata: {
          ...(row.metadata ?? {}),
          last_execution: {
            at: new Date().toISOString(),
            actor: context.userId,
            via: "orchestrator",
            ...outcome.audit,
          },
        },
      };
      if (outcome.status === "rotated") {
        patch.rotated_at = new Date().toISOString();
        if ((row.metadata as any)?.secret_value) {
          const cleaned = { ...(row.metadata as any) };
          delete cleaned.secret_value;
          cleaned.last_execution = (patch.metadata as any).last_execution;
          patch.metadata = cleaned;
        }
      }
      await context.supabase.from("handoff_secret_rotations").update(patch).eq("id", row.id);
      await context.supabase.from("handoff_events").insert({
        handoff_id: data.handoff_id,
        kind: `handoff.rotation_${outcome.status}`,
        actor_user_id: context.userId,
        details: {
          rotation_id: row.id,
          target: row.target,
          key_ref: row.key_ref,
          via: "orchestrator",
          error: outcome.error ?? null,
        },
      });
      results.push({
        id: row.id,
        target: row.target,
        key_ref: row.key_ref,
        status: outcome.status,
        error: outcome.error ?? null,
      });

      if (outcome.status === "failed") {
        const nextState = handoff.rollback_snapshot_id ? "rolled_back" : "failed";
        await context.supabase
          .from("clone_handoffs")
          .update({
            state: nextState,
            error: `rotation_failed:${row.target}:${row.key_ref}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", data.handoff_id);
        await context.supabase.from("handoff_events").insert({
          handoff_id: data.handoff_id,
          kind: "handoff.cutover_aborted",
          actor_user_id: context.userId,
          details: {
            reason: "rotation_failed",
            target: row.target,
            key_ref: row.key_ref,
            transitioned_to: nextState,
            rollback_snapshot_id: handoff.rollback_snapshot_id ?? null,
          },
        });
        return {
          ok: false as const,
          error: "rotation_failed",
          transitioned_to: nextState,
          results,
        };
      }
      if (outcome.status === "in_progress") {
        // Awaiting external evidence — stop orchestrator without failing.
        return {
          ok: true as const,
          halted: "awaiting_evidence" as const,
          rotation_id: row.id,
          target: row.target,
          key_ref: row.key_ref,
          results,
        };
      }
    }

    // Re-check: are ALL rotations now terminal?
    const { data: after } = await context.supabase
      .from("handoff_secret_rotations")
      .select("id, status")
      .eq("handoff_id", data.handoff_id);
    const outstanding = (after ?? []).filter(
      (r: any) => r.status !== "rotated" && r.status !== "skipped",
    );
    if (outstanding.length > 0) {
      return { ok: true as const, halted: "outstanding" as const, outstanding, results };
    }

    await context.supabase
      .from("clone_handoffs")
      .update({ state: "complete", completed_at: new Date().toISOString() })
      .eq("id", data.handoff_id);
    await context.supabase.from("handoff_events").insert({
      handoff_id: data.handoff_id,
      kind: "handoff.cutover_completed",
      actor_user_id: context.userId,
      details: { rotations: results.length },
    });
    return { ok: true as const, complete: true, results };
  });



