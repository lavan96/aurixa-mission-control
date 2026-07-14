# Handoff Architecture (E1–E8 scaffolding)

Round-1 deliverable: the state machine, event log, and record tables for
transferring a clone backend to a client-owned Supabase organization. The
physical work (parity compute, snapshot capture, twin provisioning, data
copy, cutover, secret rotation execution, cost export generation) is
gap-resolution work in the next round; those tables exist so the round-2
executors have a durable ledger to write into and roll back from.

## State machine (E1)

Enum `handoff_state` — canonical order:

```
draft
  → dry_run_ready              (parity report generated, no blocking issues)
  → awaiting_client_consent    (DPA signed, PAT captured, region + plan agreed)
  → snapshot_pending           (PITR pin / pg_dump / storage / auth exports queued)
  → snapshot_ready
  → twin_provisioning          (createSupabaseProject on client's PAT)
  → twin_ready                 (migrations + storage + secrets + cron + edge parity)
  → data_syncing               (pg data + auth users + storage objects)
  → cutover_scheduled
  → cutover_in_progress        (secret rotations fire here)
  → complete
```

Terminal fanout states: `rolled_back`, `failed`, `canceled`. A partial
unique index enforces at most one non-terminal handoff per clone.

## Tables

| Table | Purpose | Enhancement |
| --- | --- | --- |
| `clone_handoffs` | Top-level lifecycle row per clone/handoff | E1 |
| `handoff_events` | Append-only audit trail (`kind`, `actor`, `details`) | E1 |
| `handoff_parity_reports` | Dry-run diff output — tables/policies/functions/buckets/cron/edge/secrets/auth/extensions | E2 |
| `handoff_snapshots` | PITR pin, `pg_dump`, storage export, auth export with retention | E4 |
| `handoff_secret_rotations` | Per-target rotation ledger (clone_repo, cloudflare, stripe_endpoint, github_webhook, edge_function_env) | E5 |
| `handoff_contracts` | Signed DPA — version, terms hash, signer, IP, PDF | E7 |
| `handoff_cost_exports` | Client-facing usage-history CSV requests | E8 |
| `client_supabase_accounts` | Client org id + slug + encrypted PAT (via `CREDENTIALS_ENC_KEY`) + region policy | E3 |
| `handoff_region_plan_policies` | Admin-defined allowlists of target regions and plan tiers | E6 |

All handoff tables are admin-only (`public.is_admin(auth.uid())`) — no anon
grants. RLS enabled on every table.

## Round-1 code surface

- `src/lib/handoffs.functions.ts` — `listHandoffs`, `getHandoff`,
  `createHandoff`, `transitionHandoff`, `logHandoffEvent`,
  `recordHandoffSnapshot`, `recordSecretRotation`,
  `recordHandoffContract`, `requestCostExport`.
- `src/lib/handoff-policies.functions.ts` — CRUD on region/plan allowlists.
- `src/lib/client-supabase-accounts.functions.ts` — PAT captured via
  `encryptSecret` (AES-256-GCM), only `pat_last4` ever returned.
- `src/routes/handoffs.tsx` — fleet-wide handoff list.
- `src/routes/handoffs.new.tsx` — creation wizard.
- `src/routes/handoffs.$handoffId.tsx` — state machine controls,
  snapshot / rotation / cost-export triggers, event log.
- `src/routes/settings.handoff-policies.tsx` — E6 admin surface.

## Round-2 (gap-resolution) hooks

The tables and endpoints are designed so round 2 can add background
workers without new schema:

- **Parity engine (G1, G3–G5, G19)** — a worker enqueues an
  `handoff_parity_reports` row, computes diffs (schema, policies, RPC
  signatures, buckets, cron, edge, secrets keyset, auth config, extensions)
  against prime, and writes `risk_level` + `blocking_issues`. UI advances
  to `dry_run_ready` only when `blocking_issues` is empty.
- **Snapshot executor (G14a support)** — polls `handoff_snapshots.status
  = 'pending'`, calls the Supabase Management API for PITR / storage
  export, uploads `pg_dump` output, writes `sha256` + `size_bytes`.
- **Twin provisioner (G14a)** — reuses `createSupabaseProject` /
  `applyPrimeMigrations` / `replicateStorageBuckets` /
  `replicateCronJobs` / `deployEdgeFunctions` from
  `backend-provisioning.server.ts`, but with the client's PAT decrypted
  from `client_supabase_accounts.pat_ciphertext`.
- **Cutover orchestrator (G15, G18)** — walks
  `handoff_secret_rotations` rows in order (`stripe_endpoint` →
  `github_webhook` → `cloudflare` → `clone_repo` → `edge_function_env`),
  updating status per target, with automatic `rolled_back` transition on
  any failure that references the pinned snapshot in
  `clone_handoffs.rollback_snapshot_id`.
- **Cost export builder (E8)** — pulls
  `ai_usage_log` + `token_ledger` + `report_jobs` for the period,
  writes CSV to a new `handoff-exports` bucket, updates
  `handoff_cost_exports.status = 'ready'`.

## Client onboarding portal (G11, E3)

`/clients/$clientId/handoff` is the future entry point for third parties
to (i) create a Supabase account themselves, (ii) generate a PAT, (iii)
sign the DPA, (iv) submit both back via `/api/public/handoffs/consent`.
That route is deliberately out of round 1 — it depends on the parity
engine giving the client an honest preview of what's about to move.
