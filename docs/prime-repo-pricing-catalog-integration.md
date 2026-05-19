# Prime Repo — Pricing Catalog Integration

Drop-in addendum: wire the Prime repo to read seat roles, add-on modules,
setup packages, and per-report credit costs from Mission Control.

## New public endpoint

`GET /api/public/pricing/catalog` (Mission Control)

Auth: `x-clone-api-key` header with `tokens:meter` or any active scope.

Response:
```json
{
  "roles":   [{ "slug": "viewer", "name": "Viewer", "price_min_cents": 2900, "price_max_cents": 4900, "currency": "AUD", "permissions": [...] }],
  "addons":  [{ "slug": "portal", "name": "Client Portal", "price_min_cents": 14900, "price_max_cents": 29900, "billing_period": "monthly", "included_in_plans": ["professional","growth","enterprise"] }],
  "setups":  [{ "slug": "launch-onboarding", "name": "Launch Onboarding", "applies_to_plans": ["launch"], "deliverables": [...] }],
  "reports": [{ "slug": "full-property-report", "name": "Full Property Report", "credit_cost": 3 }]
}
```

## Drop-in prompt for the Prime repo's chat agent

> **Stack:** TanStack Start + Lovable Cloud. **No** Supabase Edge Functions.
> Aurixa credentials at `.aurixa/credentials.json`.

You are extending this app to consume Aurixa's pricing catalog:

### 1. `src/server/aurixa-catalog.server.ts` (new)

- `fetchCatalog()` — GET `{AURIXA_BASE_URL}/api/public/pricing/catalog`
  with `x-clone-api-key: {AURIXA_API_KEY}`. Cache in memory for 5 minutes.
- `getReportCreditCost(slug)` — lookup helper.
- `getSeatRole(slug)` — lookup helper.

### 2. `src/lib/aurixa-catalog.functions.ts` (new)

`createServerFn` wrappers: `getReportCost`, `listAddons`, `listSetupPackages`.

### 3. Update report submission flow

Before reserving tokens, look up the report type's credit cost:

```ts
const cost = await getReportCreditCost(reportType); // e.g. "full-property-report" -> 3
const reservation = await reserveTokens({ amount: cost, idempotency_key: jobId });
```

If `getReportCreditCost` returns `null`, default to 1 credit and log a warning.

### 4. Seat role enforcement

When inviting a user to the clone, send the chosen `role_slug` in the
seat-reserve call's metadata:

```ts
await reserveSeat({
  external_user_id, email, display_name,
  metadata: { role_slug: "standard" }
});
```

Use `getSeatRole(slug).permissions` on login to gate UI features.

### 5. UI surfaces

- Settings → Billing page: render add-ons and setup packages read-only.
- Report picker: show credit cost badge next to each report type.
- User management: show role pricing tiers when assigning roles.

All catalog data is read-only on the clone side — edits happen in Mission
Control's `/billing/catalog`.
