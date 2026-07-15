# Subdomain Fleet Hosting

Every tenant/clone in the Aurixa Mission Control fleet is reachable at
`<slug>.aurixasystems.com.au`. DNS lives in a single Cloudflare zone that
Mission Control owns; the underlying application is served by the existing
Lovable custom-domain target (A `185.158.133.1` by default, or CNAME to a
`.lovable.app` host when the zone is proxied).

The architecture is deliberately **dormant-until-active**: schema, worker
actions, UI, and audit trail all ship before the Cloudflare subscription is
turned on. Nothing breaks in the meantime — reservations are stamped
`pending_platform` and fan out automatically the moment
`CLOUDFLARE_API_TOKEN` and `platform_hosting_config.cloudflare_zone_id` are
populated.

## Data model

| Table | Purpose |
| --- | --- |
| `platform_hosting_config` | Singleton row. Primary domain, Cloudflare account/zone IDs, target A/CNAME value, `proxied`, `auto_provision`, reserved slug list. |
| `clones.subdomain` / `subdomain_fqdn` / `subdomain_status` | Per-clone intent. `subdomain` is `citext` unique. Status: `pending_platform → queued → provisioning → active` (or `failed` / `detached`). |
| `edge_dns_records` | Tracked DNS records. `managed=true` means we created it and may delete it on detach; `managed=false` is drift we observed and must never touch. |
| `edge_provisioning_jobs` (extended) | Adds actions `provision_subdomain`, `resync_subdomain`, `deprovision_subdomain`. |

All four tables are admin-only (RLS gated by `public.is_admin(auth.uid())`).

## Runtime flow

```text
clones.new (wizard)                    settings/domains
       │                                     │
       ▼                                     ▼
requestCloneSubdomain(cloneId, slug)   reconcilePendingSubdomains()
       │                                     │
       └──────────────────┬──────────────────┘
                          ▼
     edge_provisioning_jobs (idempotent by (clone,action,payload_hash))
                          │  pg_net → /hooks/edge-drain
                          ▼
                edge-drain worker
       ┌──────────────────┴─────────────────┐
       ▼                                    ▼
Cloudflare DNS API                   edge_dns_records tracker
   (create/update/delete)              (surgical, non-destructive)
                          ▼
                 clones.subdomain_status = active
```

## Cloudflare token scopes

`CLOUDFLARE_API_TOKEN` needs, in addition to the existing edge-security
scopes:

- `Zone:Read`
- `DNS:Edit`

on the zone that backs `aurixasystems.com.au`.

## Idempotency & safety

- Enqueue is upsert-on `(clone_id, provider_slug, action, payload_hash)` — a
  double-click or retry collapses to one job.
- Provisioning reuses the tracked `edge_dns_records` row when present and
  `PATCH`es the existing DNS record instead of creating a duplicate.
- Deprovisioning only deletes records where `managed=true`. Manually-created
  records the customer wants to keep are never touched.
- Reserved slugs (`www`, `api`, `admin`, …) are rejected at request time and
  configurable from Settings → Domains.

## Operator surfaces

- **Wizard** — `/clones/new` step **6b · Subdomain hosting**. Reserves the
  slug on submit; enqueues DNS provisioning when Cloudflare is live.
- **Settings** — `/settings/domains`. Configure the primary domain, zone ID,
  target A/CNAME value, proxy flag, and reserved slug list. "Reconcile
  pending" fans dormant clones into real jobs.
- **Clone page** — subdomain status is exposed on the existing clone edge
  card (shares `clone_edge_config` + `edge_audit`).

## Enabling Cloudflare later

1. Add the Cloudflare API token as `CLOUDFLARE_API_TOKEN`.
2. Open `/settings/domains`, fill in Cloudflare Account ID + Zone ID + Zone
   name, save.
3. Click **Reconcile pending** — every clone that was reserved while dormant
   fans out into `provision_subdomain` jobs and lands within a minute.
4. New clones from that point auto-provision as part of the wizard flow.

## Guarantees

- No records ever created outside the tracked table.
- No records ever deleted that we didn't create.
- Wizard submission never blocks on Cloudflare — the reservation is a fast
  DB write; DNS lands asynchronously.
- All mutations audited via `edge_audit` with actor, payload, and result.
