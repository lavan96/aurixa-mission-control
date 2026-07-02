# Per-Clone Edge Security Provisioning — Cloudflare (live) + AWS/Azure (mocked)

## Goals

- Optional, opt-in edge-security layer per clone. Never blocks clone creation.
- Cloudflare first, real API. AWS & Azure surfaced in UI as "coming soon" tiles that persist intent but don't call any API yet.
- Fleet-scale: idempotent, queued, auditable, rate-limit aware, safe to run against hundreds of zones without hitting Cloudflare's per-account limits.
- Same operator UX pattern as Supabase backend provisioning: a card on the clone page, a wizard step in `clones.new`, a fleet-wide view.

## Current state (already in repo)

We already have a partial Cloudflare surface: `cloudflare_clone_config`, `cloudflare_audit`, `cloudflare_accounts` tables; `src/server/cloudflare/client.ts` (typed CF v4 client with retry); `src/server/cloudflare.functions.ts` (attach/detach/seed/posture/analytics); `src/routes/cloudflare.tsx`; and `clones.cloudflare_enabled` / `cloudflare_zone_id` columns. This plan **builds on** that — it is not a greenfield rewrite. The gap is: no per-clone provisioner (only attach-existing-zone), no queue/worker, no security-posture presets applied end-to-end, no DNS/WAF/rate-limit templating, no fleet drift check, no multi-provider abstraction.

## Architecture

### Provider abstraction

New shared contract so Cloudflare, AWS, Azure all plug into the same orchestrator:

```text
EdgeProvider
 ├── slug: 'cloudflare' | 'aws' | 'azure'
 ├── status: 'live' | 'mocked'
 ├── attachZone(clone, input)      → provider_resource_ref
 ├── applyPosture(ref, preset)     → applied[]
 ├── syncState(ref)                → drift[]
 ├── detach(ref)                   → void
 └── analytics(ref, window)        → { requests, threats, bandwidth }
```

Cloudflare implements all methods. AWS/Azure implementations return `{ status: 'mocked' }` and write to the same audit + config tables so the UI is uniform.

### Data model (additive)

- `edge_providers` — catalog: slug, display_name, status, capabilities jsonb (`{ dns, waf, rate_limit, bot, analytics }`). Seeded with cloudflare/aws/azure.
- `clone_edge_config` — supersedes `cloudflare_clone_config` as the multi-provider table (keep old table, add view for back-compat). Columns: clone_id, provider_slug, external_ref (zone_id / distribution_id / front_door_id), account_ref, posture_preset, security_level, bot_fight, rate_limit_rps, waf_preset, custom_rules jsonb, status, last_synced_at, drift jsonb.
- `edge_provisioning_jobs` — queue: id, clone_id, provider_slug, action (`attach|apply_posture|sync|detach`), payload jsonb, status (`queued|running|succeeded|failed|retry`), attempts, next_attempt_at, error, created_by. Backing store for the fleet-scale worker.
- `edge_posture_presets` — named bundles (`lenient|balanced|strict|under_attack`) with the exact settings a preset expands to. Editable from `/cloudflare` for admins so we don't hardcode.
- Extend `cloudflare_audit` → `edge_audit` (new table, keep old view) with `provider_slug`.

Migration keeps `cloudflare_clone_config` populated via trigger so nothing existing breaks during rollout.

### Provisioning flow (Cloudflare, live)

Wizard step on `clones.new` (optional checkbox "Attach edge security"):

1. Operator picks provider (cloudflare only enabled; aws/azure disabled with "Coming soon").
2. Cloudflare path branches on mode:
   - **BYO zone**: pick from `cfListZones()` — current attach flow.
   - **New zone**: enter apex domain → we call `POST /zones` under the configured account, return NS records for the operator to set at their registrar, mark status `pending_ns`.
3. Choose posture preset + optional custom rules (rate-limit RPS, bot fight, WAF preset).
4. Submission enqueues an `edge_provisioning_jobs` row with action `attach` + `apply_posture`. Response returns immediately with `job_id`. Clone creation is **never blocked**.
5. Background worker (see Queue below) executes, streams progress into `edge_audit`, updates `clone_edge_config.status` (`pending_ns → verifying → active → drifted → failed`).

### Queue & worker (fleet-scale)

- Insert into `edge_provisioning_jobs` triggers `pg_net` to POST `/api/public/hooks/edge-provision` with Bearer auth (same pattern as existing cron hooks in `src/server/cron-auth.server.ts`).
- The route is a fan-out worker: pulls up to N queued jobs `FOR UPDATE SKIP LOCKED`, processes with a concurrency cap (default 6, per-account limited to avoid CF's 1200 req/5min token cap), writes results, requeues on transient errors with exponential backoff.
- Also polled by a new cron `hooks.edge-drain.tsx` every minute so failed webhook deliveries don't strand jobs.
- Reuses `withRetry` from `src/lib/with-retry.ts`, respects CF `429 Retry-After`.

### Drift & health

- New cron `hooks.edge-drift.tsx` (daily) walks every active `clone_edge_config`, calls `syncState`, compares live settings to intended posture, writes drift jsonb + emits a `notification` (`edge.drift_detected`) when a clone diverges — same pattern as `fleet-drift`.
- Analytics 24h totals surfaced on the clone page card and aggregated on `/cloudflare` fleet view.

### Auth, scopes, secrets

- `CLOUDFLARE_API_TOKEN` already stored. Add scope-check helper: token must have `Zone:Read`, `Zone Settings:Edit`, `DNS:Edit`, `Firewall Services:Edit`, `Analytics:Read`. `cfTokenStatus` extended to surface missing scopes so admins see a red banner on `/cloudflare` instead of failing at attach time.
- API keys: new scope `edge:manage` in `src/lib/clone-api-scopes.ts` for external callers of `/api/public/edge/*` (read-only status endpoint in phase 3, no mutations from public keys).
- All mutating server fns require admin (role_level ≥ 80) via `has_role`, matching `prime_config` pattern.

### UI surfaces

- `src/components/clone-edge-card.tsx` — twin of `clone-backend-card.tsx`. Status, posture chip, analytics sparkline, "Apply posture", "Sync now", "Detach", live job progress.
- `clones.new.tsx` — new optional "Edge Security" section beneath the existing "Dedicated Backend" section. Provider tabs (CF live, AWS/Azure disabled).
- `clones.$cloneId.tsx` — mount `<CloneEdgeCard />`.
- `cloudflare.tsx` (existing) — expand into a **fleet dashboard**: provider tiles across the top (CF active, AWS/Azure "coming soon" with waitlist toggle), fleet table (clone, provider, posture, drift, 24h requests/threats), preset editor, token health.
- `settings.index.tsx` — provider-level defaults (default account, default posture preset per new clone).

### AWS / Azure mocks (phase 1)

Purely front-end + persisted intent. No SDKs installed. Same `EdgeProvider` interface implemented as no-ops that:
- Show provider on the wizard as "Coming soon" with a "Notify me" toggle → writes to `clone_edge_config` with `status='waitlisted'` and `provider_slug='aws'|'azure'`.
- Render greyed cards with a lock icon on the clone page.
- Appear in the fleet dashboard as counts so demand is visible before we build real integrations.

## Phased execution

### Phase 1 — Foundations (schema + provider abstraction)
- Migration: `edge_providers`, `clone_edge_config`, `edge_provisioning_jobs`, `edge_posture_presets`, `edge_audit`, back-compat view over `cloudflare_clone_config`, seed CF/AWS/Azure rows and 4 presets. GRANTs + RLS (admin write, operator read).
- `src/server/edge/providers.ts` (interface + registry), `src/server/edge/cloudflare-provider.ts` (wraps existing `cloudflareApi`), stubs for `aws-provider.ts` / `azure-provider.ts`.

### Phase 2 — Provisioning pipeline
- `src/server/edge-provisioning.functions.ts` (`enqueueJob`, `getJobStatus`, `getCloneEdgeStatus`, `applyPreset`, `detachEdge`) with admin gating.
- `src/routes/api.public.hooks.edge-drain.tsx` (Bearer-auth worker) + `hooks.edge-drift.tsx` cron.
- Cron rows via migration, reusing `DRIFT_REFRESH_TOKEN` pattern (new secret `EDGE_WORKER_TOKEN`).

### Phase 3 — Operator UX
- `CloneEdgeCard` component + wire into clone page.
- `clones.new` optional wizard step (CF live; AWS/Azure mocked).
- Fleet dashboard rewrite of `/cloudflare` with provider tiles + preset editor.
- Notifications: `edge.provisioned`, `edge.drift_detected`, `edge.failed`.

### Phase 4 — Hardening & external
- Public read-only endpoint `/api/public/edge/status` (scope `edge:read`).
- Bulk actions on `/fleet-manager`: "Attach edge to selected", "Reapply posture" — piped through the same queue.
- Docs page at `docs/edge-security-integration.md`.
- Backfill: one-shot migration copies existing `cloudflare_clone_config` rows into `clone_edge_config` with `provider_slug='cloudflare'`.

## Technical notes

- **Idempotency**: every job carries a stable `(clone_id, action, payload_hash)` unique key so retries and double-fires collapse.
- **Rate limiting**: worker holds a Postgres advisory lock per Cloudflare account to serialize mutations within an account while parallelising across accounts.
- **Rollback**: `detach` is always non-destructive to the zone itself (never deletes DNS records we didn't create); only removes our tracked overrides and unlinks the row.
- **Testing**: unit tests for provider registry + preset expansion; integration test for the worker using a mocked CF client; existing `cloudflare/client.ts` retry logic reused unchanged.
- **Back-compat**: `cloudflare_clone_config` remains readable for one release; UI reads exclusively from `clone_edge_config` after phase 3.

## Out of scope (call out explicitly)

- Registrar automation (we surface NS records; operator sets them).
- Cloudflare Workers deployment per clone — separate track.
- Real AWS CloudFront / Azure Front Door integration — deliberately mocked; requires its own plan once demand is proven via the waitlist.

Ready to execute Phase 1 on approval.
