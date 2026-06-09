# Phase 4 — Server-function authorization review (M6)

Systematic review of every `createServerFn` RPC for **authentication** (is the
caller a valid session?) and **authorization** (does the caller have the right
role / own the resource?). Companion to the Phase 4 test suite.

## Threat model

`requireSupabaseAuth` (the middleware on almost every server function) proves the
caller holds a **valid Supabase session** and exposes:

- `context.supabase` — a Supabase client scoped to the caller's JWT, so all
  queries through it are **RLS-enforced** as that user; and
- `context.userId` — but it does **not** assert any role.

The app has a "no operator role assigned → Access denied" screen
(`protected-route.tsx`), which means **authenticated users without an operator
role can exist**. Server functions are callable directly over RPC regardless of
the client UI, so a logged-in non-operator can invoke any server function.

Therefore the safety of a handler depends on which client it uses:

- Handlers that query through **`context.supabase`** are gated by RLS (operator/
  admin policies) → safe.
- Handlers that use **`supabaseAdmin`** (service role) **bypass RLS**, so
  authentication alone is _not_ authorization — they need an explicit role check.

## Coverage summary

- **158** `createServerFn` definitions across 42 files.
- All but three files apply `requireSupabaseAuth` to **every** function.

| File                              | Status                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| `lib/public-pricing.functions.ts` | No auth — **intentional** public catalog read (non-PII columns only). OK. |
| `server/push-config.functions.ts` | No auth — returns the **public** VAPID key. OK.                           |
| `server/github-diff.functions.ts` | No auth — **bug, fixed in this PR** (see below).                          |

## Findings

### F1 — `fetchFileDiff` was completely unauthenticated · FIXED ✅

`server/github-diff.functions.ts` had no middleware and called the GitHub App
Octokit with **caller-supplied `owner`/`repo`**. Any anonymous caller could read
the compare diff of any (private) repo the App is installed on. **Fixed** by
adding `requireSupabaseAuth`. (A follow-up could further restrict `owner/repo` to
registered clone repos.)

### F2 — Authenticated-but-not-authorized handlers using `supabaseAdmin` · FIXED ✅ (Phase 5)

These authenticated but bypassed RLS via `supabaseAdmin` with **no role check**, so
a logged-in non-operator could invoke privileged operations. Now gated by a
role-enforcing middleware (`requireOperator` / `requireAdmin`, in
`integrations/supabase/role-middleware.ts`) that extends `requireSupabaseAuth`
with a `user_roles` check and returns 403 otherwise:

| File                                     | Privileged surface                           | Gate applied        |
| ---------------------------------------- | -------------------------------------------- | ------------------- |
| `server/clone-provisioning.functions.ts` | Provisions clones / GitHub repos / backends. | **requireAdmin**    |
| `lib/clone-api-keys.functions.ts`        | Mint / rotate / revoke clone API keys.       | **requireAdmin**    |
| `lib/token-webhooks.functions.ts`        | CRUD of token webhook endpoints.             | **requireOperator** |
| `lib/checkout-session.functions.ts`      | Reads/creates checkout-session state.        | **requireOperator** |
| `lib/stripe.functions.ts`                | Creates Stripe Checkout sessions.            | **requireOperator** |

Note on the Stripe "IDOR": this is an internal operator console (operators manage
the whole fleet, there is no per-user tenant ownership), so the correct
authorization is the operator-role gate now applied — not per-tenant ownership.

### F3 — Confirmed safe-by-design

`getPublicPricing` (public marketing page, selects only non-PII pricing columns)
and `getVapidPublicKey` (public key the browser needs to subscribe to push).

## Resolution status (Phase 5)

1. ✅ Added `requireOperator` / `requireAdmin` middleware (composes
   `requireSupabaseAuth` + a `user_roles` check → 403).
2. ✅ Applied per the F2 table.
3. ✅ Stripe/checkout gated by `requireOperator` (per-tenant ownership N/A — this
   is a fleet operator console, see note above).
4. ↩️ Optional further hardening: prefer `context.supabase` (RLS) over
   `supabaseAdmin` in handlers that don't truly need service-role privileges, and
   re-confirm per-feature role tiers against the UI's own gating. Left as a
   non-urgent follow-up since the role gate already closes the access gap.

**Behavioral note:** an authenticated user with _no_ operator role can no longer
invoke these functions over RPC (they get 403). All users who can reach the
admin UI already hold an operator role (`protected-route.tsx`), so no legitimate
UI flow is affected; provisioning and API-key minting now additionally require an
admin role.
