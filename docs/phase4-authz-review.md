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
  authentication alone is *not* authorization — they need an explicit role check.

## Coverage summary

- **158** `createServerFn` definitions across 42 files.
- All but three files apply `requireSupabaseAuth` to **every** function.

| File | Status |
|---|---|
| `lib/public-pricing.functions.ts` | No auth — **intentional** public catalog read (non-PII columns only). OK. |
| `server/push-config.functions.ts` | No auth — returns the **public** VAPID key. OK. |
| `server/github-diff.functions.ts` | No auth — **bug, fixed in this PR** (see below). |

## Findings

### F1 — `fetchFileDiff` was completely unauthenticated · FIXED ✅
`server/github-diff.functions.ts` had no middleware and called the GitHub App
Octokit with **caller-supplied `owner`/`repo`**. Any anonymous caller could read
the compare diff of any (private) repo the App is installed on. **Fixed** by
adding `requireSupabaseAuth`. (A follow-up could further restrict `owner/repo` to
registered clone repos.)

### F2 — Authenticated-but-not-authorized handlers using `supabaseAdmin` · OPEN (recommend Phase 5)
These authenticate but bypass RLS via `supabaseAdmin` with **no role check**, so
a logged-in non-operator could invoke privileged operations:

| File | Privileged surface |
|---|---|
| `server/clone-provisioning.functions.ts` | Provisions clones / GitHub repos / backends. Only *incidentally* gated by the RLS on its first `context.supabase` read of `prime_config` — fragile. |
| `lib/clone-api-keys.functions.ts` | Mint / rotate / revoke clone API keys. |
| `lib/token-webhooks.functions.ts` | CRUD of token webhook endpoints. |
| `lib/checkout-session.functions.ts` | Reads/creates checkout-session state. |
| `lib/stripe.functions.ts` | Creates Stripe Checkout sessions; `tenantId`/`cloneId` come from input with **no ownership check** (IDOR: a user can target another tenant). |

### F3 — Confirmed safe-by-design
`getPublicPricing` (public marketing page, selects only non-PII pricing columns)
and `getVapidPublicKey` (public key the browser needs to subscribe to push).

## Recommendation (Phase 5)

1. Add role-enforcing middleware that extends `requireSupabaseAuth`, e.g.
   `requireOperatorAuth` (asserts `is_operator(userId)`) and `requireAdminAuth`
   (asserts `has_role(userId, 'admin')`), returning 403 otherwise.
2. Apply per the F2 table — admin for provisioning / API-key minting / webhook
   config; operator for the rest.
3. For `stripe.functions.ts` / `checkout-session.functions.ts`, additionally
   verify the caller owns the supplied `tenantId`/`cloneId` (close the IDOR).
4. Prefer `context.supabase` (RLS) over `supabaseAdmin` in handlers wherever the
   operation does not genuinely require service-role privileges.

These are behavioral changes (a non-operator who currently *can* call these would
start getting 403), so they are scoped to a follow-up rather than bundled here.
