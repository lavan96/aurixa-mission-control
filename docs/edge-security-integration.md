# Edge Security Integration

Per-clone optional edge/CDN provisioning. Cloudflare is live; AWS CloudFront and Azure Front Door are surfaced as waitlist-only stubs so demand is visible before real integrations ship.

## Concepts

- **Provider** — `edge_providers` row. `cloudflare` is `live`; `aws`, `azure` are `mocked` (waitlist).
- **Config** — `clone_edge_config` row per (clone, provider). Tracks external reference (zone id / distribution id), posture preset, status, and last sync.
- **Posture preset** — `edge_posture_presets` row. Named bundle (`lenient`, `balanced`, `strict`, `under_attack`) expanded into concrete settings (security level, bot fight, rate-limit RPS, WAF preset).
- **Job** — `edge_provisioning_jobs` row. Queued unit of work (`attach`, `apply_posture`, `sync`, `detach`) executed by the drain worker.
- **Audit** — `edge_audit` row. Immutable trail of every mutation, actor, payload, and result.

## Provisioning flow

1. Operator opts in from the clone page (`CloneEdgeCard`) or the `/clones/new` wizard.
2. UI calls `enqueueEdgeJob` — an admin-gated server fn — which upserts a job by `(clone_id, provider_slug, action, payload_hash)` for idempotency.
3. `pg_net` fires `POST /api/public/hooks/edge-drain` on insert. The daily `EDGE_WORKER_TOKEN`-backed cron sweeps orphans.
4. Worker pulls up to N queued jobs with `FOR UPDATE SKIP LOCKED`, invokes the provider (`src/server/edge/*`), writes to `clone_edge_config` and `edge_audit`, retries on transient errors with exponential backoff.
5. Mocked providers (AWS/Azure) resolve immediately with `status='waitlisted'`.

Drift detection runs daily via `/api/public/hooks/edge-drift`, comparing live provider state to intended posture and emitting `edge.drift_detected` notifications.

## Public API

`GET /api/public/edge/status`

Authenticated with `x-clone-api-key` (scope `edge:read` or `edge:manage`). Returns the calling key's clone edge configuration only.

```json
{
  "ok": true,
  "clone_id": "…",
  "providers": [
    {
      "provider_slug": "cloudflare",
      "hostname": "clone.example.com",
      "status": "active",
      "status_detail": null,
      "posture_preset": "balanced",
      "last_synced_at": "2026-07-02T…"
    }
  ],
  "pending_jobs": []
}
```

## Operator surfaces

- **Clone page** — `CloneEdgeCard` shows status, posture picker, sync/detach actions, and recent job history.
- **Wizard** — optional "Edge security" step in `/clones/new` (Cloudflare live; AWS/Azure waitlist toggles).
- **Fleet dashboard** — `/fleet/edge` provides a bird's-eye table with filters, bulk selection, and bulk actions (reapply preset, sync selected).
- **Notifications** — `edge.provisioned`, `edge.drift_detected`, `edge.failed`.

## Secrets

- `CLOUDFLARE_API_TOKEN` — must include `Zone:Read`, `Zone Settings:Edit`, `DNS:Edit`, `Firewall Services:Edit`, `Analytics:Read`.
- `EDGE_WORKER_TOKEN` — Bearer token for `/api/public/hooks/edge-*`, injected by cron via Vault.

## Guarantees

- **Idempotent** — repeated identical enqueues collapse into a single job.
- **Rate-limit aware** — Cloudflare mutations serialize per-account via a Postgres advisory lock inside the worker.
- **Non-destructive detach** — never deletes DNS records we didn't create; only removes tracked overrides and unlinks the config row.
- **RLS** — admins (`role_level ≥ 80`) write, operators read; external API keys are scoped to their clone.
