# Prime Repo — Wire Investment Report Through Mission Control Token Metering

**Drop-in prompt for the Prime repo coding agent.** Paste the entire body
below into a fresh Prime-repo chat. Mission Control side is already correct —
the only gap is that the Prime app reads `/balance` but never calls
`/reserve` + `/commit`, so the meter never moves.

---

## Context

The investment-report generator currently runs without metering. We can see
on the Mission Control side that:

- `clone_api_keys` shows `last_used_at` updating (so the key works) — but
  only `/api/public/tokens/balance` is being hit.
- `report_jobs` table is empty (zero rows for this clone).
- `token_ledger` only has the initial `grant` row — no `reserve`, `debit`,
  or `release` entries.

That means the report pipeline is generating reports without ever calling
`reserveTokens` / `commitTokens`. Fix that.

## Required secrets (already set, verify)

| Name | Value |
| --- | --- |
| `MISSION_CONTROL_URL` | `https://aurixa-mission-control.lovable.app` |
| `MISSION_CONTROL_CLONE_API_KEY` | Starts with `mck_` (scope must include `tokens:meter`) |

## Step 1 — Ensure the token client exists

If `src/server/tokens.client.ts` is missing or incomplete, create/update it
per `docs/prime-repo-token-integration.md` §2 (`reserveTokens`,
`commitTokens`, `cancelTokens`, `getBalance`, `InsufficientTokensError`).

## Step 2 — Look up the report's credit cost from the catalog

Mission Control exposes per-report-type costs at
`GET /api/public/pricing/catalog` → `report_credit_costs`. The relevant row:

```
{ "slug": "investment-analysis", "credits": 3, ... }
```

Add a small cached helper:

```ts
// src/server/report-credit-costs.ts
import { call } from "./tokens.client";

let cache: { at: number; map: Map<string, number> } | null = null;
const TTL_MS = 5 * 60_000;

export async function getReportCreditCost(slug: string): Promise<number> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const res = await call<{
      ok: true;
      reports: Array<{ slug: string; credits: number }>;
    }>(`/api/public/pricing/catalog`, { method: "GET" });
    cache = {
      at: Date.now(),
      map: new Map(res.reports.map((r) => [r.slug, r.credits])),
    };
  }
  return cache.map.get(slug) ?? 1; // safe default
}
```

(`call` is the same helper exported from `tokens.client.ts` — export it if
it's currently private.)

## Step 3 — Wrap the investment-report server function

Find the server fn that produces an investment report (likely something like
`src/lib/reports.functions.ts` → `generateInvestmentReport`). Wrap its body
in the canonical reserve → run → commit / cancel pattern:

```ts
import {
  reserveTokens,
  commitTokens,
  cancelTokens,
  InsufficientTokensError,
} from "@/server/tokens.client";
import { getReportCreditCost } from "@/server/report-credit-costs";

export const generateInvestmentReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(InvestmentReportInputSchema)
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const reportRequestId = data.reportRequestId ?? crypto.randomUUID();
    const estimate = await getReportCreditCost("investment-analysis");

    const reservation = await reserveTokens({
      tenantRef: userId,
      kind: "report.investment",
      estimatedTokens: estimate,
      idempotencyKey: `investment:${reportRequestId}`,
      requestPayload: { propertyId: data.propertyId },
    });

    try {
      const { report, usage } = await runInvestmentReportPipeline(data);

      await commitTokens({
        jobId: reservation.job_id,
        actualTokens: usage?.totalTokens ?? estimate,
        resultMeta: { pages: report.pages, model: usage?.model },
      });

      return { report, reportRequestId };
    } catch (err) {
      await cancelTokens({
        jobId: reservation.job_id,
        reason: err instanceof Error ? err.message.slice(0, 280) : "failed",
      }).catch(() => {});
      throw err;
    }
  });
```

### Notes
- `idempotencyKey` MUST be deterministic per logical attempt — reuse it on
  retries so the user is never double-charged.
- If your pipeline doesn't return real token usage, fall back to `estimate`
  on commit (still produces a clean ledger entry and decrements the meter).
- Surface `InsufficientTokensError` in the intake form via the
  `OutOfTokensBanner` (see `docs/prime-repo-token-integration.md` §7).

## Step 4 — Apply the same wrapper to every other report type

Repeat Step 3 for every other report entry point, using the matching catalog
slug:

| Catalog slug | Use for |
| --- | --- |
| `property-snapshot` | quick single-property snapshots |
| `comparative-market` | CMA reports |
| `investment-analysis` | investment / yield reports |
| `portfolio-report` | multi-property portfolio rollups |
| `due-diligence` | deep DD reports |
| ...etc. | (see `/api/public/pricing/catalog` → `reports`) |

Any report that runs without reserve+commit will not move the meter.

## Step 5 — Refresh the in-app balance display after commit

If the dashboard caches `getBalance(userId)`, invalidate it once the server
fn returns. The `tokens.balance.updated` webhook (see token-integration §10)
also fires automatically — wire that handler if not already done so other
sessions update in real time.

## Acceptance check

After deploying, generate one investment report and verify in Mission
Control:

1. `report_jobs` has a new row with `status = 'completed'` and a non-zero
   `charged_tokens`.
2. `token_ledger` shows `reserve` → `release` → `debit` rows for that job.
3. `token_balances.available` for the tenant decreased by the charged amount.
4. The Prime dashboard's balance counter reflects the new value.

If any of those four is missing, the wrapper is not in the actual code path
the user is hitting — search for every entry point that returns an
investment report and re-check.
