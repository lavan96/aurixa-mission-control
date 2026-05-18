
# Report Token Metering — Architecture Plan

Goal: every clone (starting with prime) meters report generation against a per-tenant token balance. Mission Control is the **source of truth** for entitlements, balances, ledgers, plans, and top-ups. Clones are **thin consumers** that check/charge through a signed API.

---

## 1. Concepts (shared vocabulary)

- **Tenant** — billing unit. Usually a clone's end-user account. Mission Control owns the tenant registry so a user keeps balance if they move between clones in the same fleet (configurable).
- **Plan** — subscription tier. Grants `monthly_allowance` tokens, optional `rollover_cap`, `overage_policy` (`block` | `topup_only` | `pay_as_you_go`).
- **Allowance grant** — recurring entitlement issued on each billing cycle.
- **Top-up pack** — one-off purchase, adds tokens with optional expiry.
- **Ledger entry** — immutable row: grant, top-up, debit, refund, adjustment.
- **Balance** — derived view (sum of non-expired credits − debits). Cached for read speed, rebuilt from ledger.
- **Report job** — a single chargeable unit. Cost = `base_cost + Σ(metered_units × rate)` (e.g. pages, AI tokens, MB).

---

## 2. Mission Control — DB schema

All in `public` schema, RLS on, written via migration.

### `billing_plans`
`id, slug, name, monthly_allowance int, rollover_cap int, overage_policy enum, price_cents int, currency, is_active, metadata jsonb`.

### `topup_packs`
`id, slug, name, tokens int, price_cents int, currency, expires_after_days int null, is_active`.

### `tenants`
`id, clone_id (fk clones, nullable for fleet-wide), external_ref text, display_name, plan_id (fk), plan_started_at, current_period_start, current_period_end, status enum(active|past_due|canceled), metadata jsonb`.
Unique `(clone_id, external_ref)`.

### `token_ledger` (append-only)
`id, tenant_id, kind enum(grant|topup|debit|refund|adjustment|expiry), tokens int (+/-), source enum(subscription|topup|manual|system), source_ref text, report_job_id uuid null, expires_at, created_by uuid, created_at, metadata jsonb`.
Indexes: `(tenant_id, created_at desc)`, `(tenant_id, expires_at)`.

### `token_balances` (materialized cache)
`tenant_id pk, available int, reserved int, lifetime_granted int, lifetime_spent int, updated_at`.
Rebuilt by trigger on `token_ledger` insert and a nightly reconciliation job.

### `report_jobs`
`id, tenant_id, clone_id, kind text, status enum(pending|reserved|completed|failed|refunded), estimated_tokens int, charged_tokens int, idempotency_key text unique, request_payload jsonb, result_meta jsonb, started_at, completed_at, error`.
Index `(tenant_id, started_at desc)`, unique `(clone_id, idempotency_key)`.

### `token_rates`
`id, kind text, base_cost int, per_unit jsonb` (e.g. `{"pages":2,"ai_input_tokens":0.001}`). Keyed by report `kind`, versioned by `effective_from`.

### `clone_api_keys`
`id, clone_id, key_hash, scopes text[], last_used_at, revoked_at`. Plain key shown once on create. Used by clones to call the metering API.

### RLS
- Operators (`is_operator`): read everything, write `tenants`, `report_jobs`, manual `adjustment` ledger entries.
- Admins: write `billing_plans`, `topup_packs`, `token_rates`, `clone_api_keys`.
- No direct client writes to `token_ledger` or `token_balances` — only via `SECURITY DEFINER` RPCs (`reserve_tokens`, `commit_tokens`, `refund_tokens`, `grant_tokens`, `topup_tokens`).

### Triggers / functions
- `recompute_balance(tenant_id)` SQL function.
- `tg_ledger_after_insert` → recompute balance.
- `tg_expire_credits` cron (`pg_cron` or scheduled server fn) — issues `expiry` debits and rolls over per `rollover_cap`.
- `tg_renew_period` cron — for each `active` tenant where `current_period_end < now()`: insert `grant` and advance window.

---

## 3. Mission Control — Server functions (`src/server/tokens.functions.ts`)

All `createServerFn`, RLS via `requireSupabaseAuth`:

- `listTenants({ cloneId?, search?, status? })`
- `getTenant({ id })` → tenant + plan + balance + last 50 ledger entries
- `assignPlan({ tenantId, planId })`
- `grantTokens({ tenantId, tokens, reason, expiresAt? })` — manual operator grant
- `applyTopup({ tenantId, packId })` — manual; webhook will call internal version
- `listPlans()` / `upsertPlan(...)` (admin)
- `listPacks()` / `upsertPack(...)` (admin)
- `listRates()` / `upsertRate(...)` (admin)
- `issueCloneApiKey({ cloneId, scopes })` → `{ keyOnce }`
- `revokeCloneApiKey({ id })`
- `listReportJobs({ tenantId?, cloneId?, status?, limit })`
- `refundJob({ jobId, reason })`

---

## 4. Mission Control — Public metering API (`src/routes/api/public/tokens/*`)

Called by clones. Auth: header `x-clone-api-key`. Rate limited, all input zod-validated. All writes idempotent via `idempotency_key`.

- `POST /api/public/tokens/reserve`
  body: `{ tenant_ref, kind, estimated_units, idempotency_key }`
  returns: `{ job_id, reserved_tokens, balance_after }` or `402 insufficient_funds`.
- `POST /api/public/tokens/commit`
  body: `{ job_id, actual_units, result_meta? }`
  returns: `{ charged_tokens, balance_after }`.
- `POST /api/public/tokens/cancel`
  body: `{ job_id }` → releases reservation.
- `GET /api/public/tokens/balance?tenant_ref=...`
  returns: `{ available, period_end, plan_slug }`.
- `POST /api/public/tokens/topup` (server-to-server, signed) — invoked by Stripe/Paddle webhook handler in Mission Control, not by clones.

Two-phase (reserve→commit) is required because token cost isn't known until the report finishes (AI usage, pages). Reserve uses `estimated_units`; commit reconciles delta.

---

## 5. Mission Control — UI (new section `Settings → Billing & Tokens`)

- **Plans** — CRUD for `billing_plans`.
- **Top-up Packs** — CRUD for `topup_packs`.
- **Rates** — CRUD for `token_rates` per report kind.
- **Tenants** — table across all clones: search, filter by plan/status, sparkline of last 30d spend, balance pill (green/amber/red).
- **Tenant detail** — balance breakdown (subscription vs top-up vs expiring soon), full ledger with filters, recent report jobs, actions: grant, apply top-up, change plan, refund job.
- **Clone integration** — per-clone page: API keys (issue/revoke), copy-paste setup snippet, last 24h call volume, error rate.
- **Fleet usage dashboard** — total tokens consumed per day, top 10 tenants, top 10 report kinds, % of tenants at >80% of allowance (renewal-risk signal).

Reuse existing `CopyButton`, `SavedViewsBar`, `exportRowsAsCSV`, push notifications (alert on `balance < 10%`).

---

## 6. Payments

Subscriptions and top-ups are sold through Lovable Payments (Stripe or Paddle). Out of scope for this batch — landing webhooks will call `grantTokens`/`applyTopup` internal functions. Architecture is provider-agnostic: a single `payment_events` table records the webhook payload and the resulting ledger entry id.

---

## 7. Prime repo — integration contract

I cannot write to the prime repo from here. Below is the **drop-in prompt** to paste into the prime repo's coding agent. It assumes the prime repo is a TanStack Start app on Lovable Cloud (same template as Mission Control). Adjust if the prime uses a different stack.

```text
Add report-token metering to this app. All metering is delegated to the
external Mission Control service at MISSION_CONTROL_URL using
CLONE_API_KEY. Do NOT track balances locally.

Secrets to add:
- MISSION_CONTROL_URL  (e.g. https://aurixa-mission-control.lovable.app)
- CLONE_API_KEY        (issued from Mission Control → Clone integration)

1. Create src/server/tokens.client.ts with three server-only helpers:
   reserveTokens({ tenantRef, kind, estimatedUnits, idempotencyKey })
   commitTokens({ jobId, actualUnits, resultMeta? })
   cancelTokens({ jobId })
   Each does fetch(`${MISSION_CONTROL_URL}/api/public/tokens/<action>`,
   { method: "POST", headers: { "x-clone-api-key": CLONE_API_KEY,
   "content-type": "application/json" }, body: JSON.stringify(...) }).
   Throw TokenInsufficientError on HTTP 402, TokenServiceError otherwise.

2. Identify every report-generation entry point (server functions that
   produce a downloadable report or AI-authored content). Wrap each in:
     const job = await reserveTokens({...estimate});
     try {
       const result = await generateReport(...);
       await commitTokens({ jobId: job.job_id,
                            actualUnits: result.metering });
       return result;
     } catch (err) {
       await cancelTokens({ jobId: job.job_id });
       throw err;
     }
   The idempotencyKey must be deterministic per user request
   (e.g. hash of request payload + user id + minute bucket).

3. tenantRef = the app's stable user/tenant id (auth.uid() or org id).
   The first call from a new tenantRef auto-provisions a Mission Control
   tenant on the configured default plan.

4. Add a UI banner that fetches GET /api/public/tokens/balance once per
   session and warns when available < 10% of plan allowance, with a
   "Manage subscription" link to MISSION_CONTROL_URL/billing/<tenantRef>.

5. Surface a per-report receipt in the UI: "Charged N tokens. Balance: M."
   using the commit response.

6. Do not implement plans, top-ups, or payment UI in this repo.
   All purchasing flows live in Mission Control.
```

---

## 8. Rollout sequence

```text
1. Migration: plans, packs, tenants, ledger, balances, jobs, rates, api_keys
   + RLS + RPCs (reserve/commit/refund) + triggers + cron renewals.
2. Server fns + public API routes + key-auth middleware.
3. Mission Control UI: Plans, Packs, Rates, Tenants list + detail.
4. Issue first clone API key, copy into prime repo secrets.
5. Apply the prime-repo prompt; ship metered reports behind feature flag.
6. Backfill: import existing prime users as tenants on the free plan.
7. Wire payments (separate batch) → grants flow automatically.
```

---

## 9. Open questions (please confirm before I build)

1. **Tenant identity**: is a "tenant" = one end-user, one org/workspace, or one clone? Drives whether `tenants.external_ref` is `auth.uid()` or an org id.
2. **Reservation timeout**: default 10 min before a reserved-but-uncommitted job auto-cancels — OK?
3. **Overage policy default**: block, top-up-only, or pay-as-you-go?
4. **Rollover**: do unused monthly tokens roll over (with cap) or expire at period end?
5. **Pricing model for `token_rates`**: do you want a fixed cost per report, or fully metered by AI tokens + pages? (Affects whether reserve estimates are tight or generous.)
6. **Cross-clone balance**: does a tenant's balance follow them across clones, or is each clone-tenant pair independent?
