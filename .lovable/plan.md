# Seat Entitlements Architecture

## What I understood

You want a **seat (user profile) entitlement system** per clone, mirroring the token-metering architecture we already built:

1. **Prime repo = baseline tier**: 4 seats included → becomes the "Starter" plan.
2. **Tiered plans** (mock pricing for now): Starter (4), Growth, Pro, Enterprise — each with a seat cap.
3. **Per-clone entitlement**: each clone is assigned a seat plan; Mission Control shows usage vs. cap.
4. **Prime-repo integration**: the clone's frontend asks Mission Control "can this user be created?" via the same `x-clone-api-key` mechanism we use for tokens. Reserve → commit on signup; release on delete.
5. **Future hook (not in this pass)**: device limit per seat. We'll leave the schema room for it.

This is a direct seat-side parallel to `token_packs` + `/api/public/tokens/*`.

## Architecture

```text
billing_plans (extend)              seat_plans (new)
  + seat_tier ──────────────────►   id, slug, name,
                                     seat_limit, device_limit,
                                     price_cents, currency, is_active

clone_seat_entitlements (new)
  clone_id, seat_plan_id,
  seats_used (cached), status,
  granted_at, expires_at

clone_seats (new)  ◄── source of truth for "who occupies a seat"
  id, clone_id, external_user_id (from clone's auth),
  email, display_name, status (active|invited|removed),
  device_count (future), created_at, removed_at

seat_audit (new)
  clone_id, action (reserve|commit|release|cap_hit|plan_change),
  external_user_id, actor, metadata
```

## Public API (mirrors token endpoints)

All under `/api/public/seats/*`, auth via `x-clone-api-key` (existing `clones:rotate`-style scope → new `seats:manage`).

- `POST /api/public/seats/reserve` — `{ external_user_id, email }` → returns `{ reservation_id, seats_remaining }` or 402 with `{ error: "seat_limit_reached", upgrade_url }`.
- `POST /api/public/seats/commit` — finalize on successful signup.
- `POST /api/public/seats/release` — on user delete/deactivate.
- `GET  /api/public/seats/entitlement` — current plan, cap, used, remaining.
- `GET  /api/public/seats/list` — paginated list of seats (for clone's admin UI).

Idempotency key + signed webhooks (`seats.limit.approaching`, `seats.limit.reached`, `seats.plan.changed`) reusing the existing webhook delivery infrastructure.

## Mission Control UI

- **`/billing/seats`** (new): plan catalog cards (Starter 4 / Growth 10 / Pro 25 / Enterprise custom), search/filter like topup, mock prices.
- **`/settings/billing` → Seat Entitlements panel**: per-clone table — plan, used/cap progress bar, change plan, view seats, audit trail.
- **Clone detail page (`/clones/$cloneId`)**: "Seats" tab — list, manual add/remove, force-release, device count column (placeholder).
- **Notifications**: new kinds `seat_limit_approaching` (≥80%), `seat_limit_reached`, `seat_plan_changed`.

## Prime-repo agent prompt (parallel to the tokens one)

Once Mission Control side ships, I'll generate the matching drop-in prompt for the Prime repo's chat agent — credential loader already exists (`.aurixa/credentials.json`), so it's just a `seats.server.ts` client + hook into the signup/delete flows.

## Implementation phases

1. **DB migration**: `seat_plans`, `clone_seat_entitlements`, `clone_seats`, `seat_audit`, enum additions, RLS, RPC `reserve_seat`/`commit_seat`/`release_seat` (atomic counter updates, prevents race overshoot), seed 4 mock plans.
2. **Server functions** (`src/lib/seats.functions.ts`): admin list/assign-plan/change-plan, dashboard summary.
3. **Public routes** (`src/routes/api.public.seats.{reserve,commit,release,entitlement,list}.ts`): reuse `resolveCloneApiKey`, idempotency, signed responses.
4. **Mission Control UI**: `/billing/seats` catalog + entitlement panels in `/settings/billing` and `/clones/$cloneId`.
5. **Webhooks + notifications**: extend `fireTokenWebhook` infra → generic `fireSystemWebhook`, add `seat_*` notification kinds.
6. **Prime-repo prompt**: drop-in spec for the clone-side integration.

Phase 1+2+3 unlocks the API surface; 4 makes it operable; 5 makes it observable; 6 closes the loop with the clone.

## Open questions before I build

1. **Seat counts per tier** — confirm: Starter 4 / Growth 10 / Pro 25 / Enterprise unlimited? Or different numbers?
2. **Overage policy** — when a clone hits its cap: hard block (recommended, mirrors token `overage_policy='block'`), soft warn, or auto-upgrade?
3. **Who counts as a seat** — every authenticated user in the clone's `auth.users`, or only users with a specific role (e.g. exclude end-customers from B2C clones)? My default: every auth user, clone decides what to report.
4. **Device limit** — you said "later", confirmed I'll just reserve the schema column and skip enforcement for now.

Answer those four and I'll execute phases 1–6 in one push.
