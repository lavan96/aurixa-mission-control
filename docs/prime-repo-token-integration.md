# Prime Repo — Mission Control Token Metering Integration

Drop-in instructions for the prime repo coding agent. Mission Control owns all
balances, plans, top-ups, and ledgers. The prime repo only **reserves** tokens
before generating a report and **commits** (or **cancels**) when it finishes.

## 1. Secrets (set in prime repo)

| Name | Value |
| --- | --- |
| `MISSION_CONTROL_URL` | `https://aurixa-mission-control.lovable.app` |
| `MISSION_CONTROL_CLONE_API_KEY` | Issue in Mission Control → Settings → Billing & Tokens → API Keys. Starts with `mck_`. |

## 2. Client module — `src/server/tokens.client.ts`

```typescript
const BASE = process.env.MISSION_CONTROL_URL!;
const KEY = process.env.MISSION_CONTROL_CLONE_API_KEY!;

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-clone-api-key": KEY,
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(`tokens:${path} ${res.status} ${json.error ?? "failed"}`);
  }
  return json;
}

export type ReserveResult = {
  ok: true;
  job_id: string;
  reserved_tokens: number;
  available_after: number;
  idempotent?: boolean;
  status?: string;
};

export function reserveTokens(input: {
  tenantRef: string;            // stable user/org id from prime app
  displayName?: string;
  kind: string;                 // e.g. "report.full", "report.summary"
  estimatedTokens: number;
  idempotencyKey: string;       // deterministic per logical report attempt
  ttlSeconds?: number;
  requestPayload?: Record<string, unknown>;
}) {
  return call<ReserveResult>("/api/public/tokens/reserve", {
    method: "POST",
    body: JSON.stringify({
      tenant_ref: input.tenantRef,
      display_name: input.displayName,
      kind: input.kind,
      estimated_tokens: input.estimatedTokens,
      idempotency_key: input.idempotencyKey,
      ttl_seconds: input.ttlSeconds,
      request_payload: input.requestPayload,
    }),
  });
}

export function commitTokens(input: {
  jobId: string;
  actualTokens: number;
  resultMeta?: Record<string, unknown>;
}) {
  return call<{ ok: true; charged_tokens: number; available_after: number }>(
    "/api/public/tokens/commit",
    {
      method: "POST",
      body: JSON.stringify({
        job_id: input.jobId,
        actual_tokens: input.actualTokens,
        result_meta: input.resultMeta,
      }),
    },
  );
}

export function cancelTokens(input: { jobId: string; reason?: string }) {
  return call<{ ok: true }>("/api/public/tokens/cancel", {
    method: "POST",
    body: JSON.stringify({ job_id: input.jobId, reason: input.reason }),
  });
}

export function getBalance(tenantRef: string, displayName?: string) {
  const q = new URLSearchParams({ tenant_ref: tenantRef });
  if (displayName) q.set("display_name", displayName);
  return call<{
    ok: true;
    tenant: { current_period_end: string | null; billing_plans: { name: string; monthly_allowance: number; overage_policy: string } | null };
    balance: { available: number; reserved: number; lifetime_granted: number; lifetime_spent: number };
  }>(`/api/public/tokens/balance?${q.toString()}`, { method: "GET" });
}
```

## 3. Report generation pattern

Wrap **every** report entry point with reserve → generate → commit/cancel.

```typescript
import { reserveTokens, commitTokens, cancelTokens } from "@/server/tokens.client";

export async function generateReport(params: {
  userId: string;            // tenantRef
  reportRequestId: string;   // stable id for this attempt
  inputs: ReportInputs;
}) {
  const estimate = estimateTokens(params.inputs); // your heuristic

  const reservation = await reserveTokens({
    tenantRef: params.userId,
    kind: "report.full",
    estimatedTokens: estimate,
    idempotencyKey: `report:${params.reportRequestId}`,
    requestPayload: { inputs_summary: summarize(params.inputs) },
  });

  try {
    const { report, usage } = await runReportPipeline(params.inputs);

    await commitTokens({
      jobId: reservation.job_id,
      actualTokens: usage.totalTokens, // real spend
      resultMeta: { pages: report.pages, model: usage.model },
    });

    return report;
  } catch (err) {
    await cancelTokens({
      jobId: reservation.job_id,
      reason: err instanceof Error ? err.message.slice(0, 280) : "generation_failed",
    }).catch(() => {}); // best-effort; reservation auto-expires after TTL
    throw err;
  }
}
```

### Rules
- **`idempotencyKey` must be deterministic** for a given logical attempt — retrying with the same key returns the existing job instead of double-charging.
- **`tenantRef`** = your stable user or org id. Mission Control auto-provisions the tenant on first call and grants the default plan's monthly allowance.
- **Always commit or cancel.** Uncommitted reservations auto-release after `ttl_seconds` (default 600), but explicit cancel frees balance immediately.
- **`actualTokens` may exceed the reservation** — Mission Control honors it (subject to plan overage policy). Reserve generously when uncertain.

## 4. Pre-flight balance banner (optional but recommended)

On session load (or in your report intake form):

```typescript
const { balance, tenant } = await getBalance(userId);
const allowance = tenant.billing_plans?.monthly_allowance ?? 0;
const lowThreshold = allowance * 0.1;

if (balance.available < lowThreshold) {
  showBanner({
    text: `Only ${balance.available.toLocaleString()} tokens left this period.`,
    action: { label: "Manage subscription", href: "<billing url>" },
  });
}
```

## 5. Out of scope for the prime repo

Do **not** build plans, top-up packs, payment UI, ledger views, or refunds in
the prime repo. All of that lives in Mission Control. The prime repo's only
billing surface is: pre-flight balance check + post-report receipt.

## 6. Error handling

| Error from Mission Control | Meaning | Prime repo action |
| --- | --- | --- |
| `unauthorized` (401) | Bad/revoked `x-clone-api-key` | Page on-call; do not retry. |
| `insufficient_funds` (200, `ok:false`) | Balance < estimate, plan blocks overage | Show "Out of tokens — top up" CTA; do not start the report. |
| `job_not_found` / `forbidden` | Job from a different clone | Bug — log and surface. |
| `invalid_input` (400) | Schema mismatch | Bug — log payload. |
| Network/5xx on commit | Mission Control unreachable after generation | Retry commit with same `job_id` (commit is idempotent on completed jobs). |
