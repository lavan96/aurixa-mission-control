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
| `insufficient_funds` (200, `ok:false`) | Balance < estimate, plan blocks overage | Show "Out of tokens — top up" CTA; do not start the report. See §7. |
| `job_not_found` / `forbidden` | Job from a different clone | Bug — log and surface. |
| `invalid_input` (400) | Schema mismatch | Bug — log payload. |
| Network/5xx on commit | Mission Control unreachable after generation | Retry commit with same `job_id` (commit is idempotent on completed jobs). |

## 7. Out-of-tokens UI flow

When `reserveTokens` rejects with `insufficient_funds`, the response body is:

```json
{ "ok": false, "error": "insufficient_funds", "available": 240, "required": 1500 }
```

Surface this as a dedicated state — never a generic toast.

### 7a. Typed error class

Update `tokens.client.ts` so callers can `instanceof`-check the failure:

```typescript
export class InsufficientTokensError extends Error {
  constructor(public available: number, public required: number) {
    super(`insufficient_funds: have ${available}, need ${required}`);
    this.name = "InsufficientTokensError";
  }
}

// inside `call()`:
if (json.ok === false && json.error === "insufficient_funds") {
  throw new InsufficientTokensError(
    (json as any).available ?? 0,
    (json as any).required ?? 0,
  );
}
```

### 7b. Intake-form guard

```tsx
import { InsufficientTokensError } from "@/server/tokens.client";
import { OutOfTokensBanner } from "@/components/out-of-tokens-banner";

const [outOfTokens, setOutOfTokens] = useState<{ available: number; required: number } | null>(null);

async function onSubmit() {
  setOutOfTokens(null);
  try {
    const report = await generateReport({ userId, reportRequestId, inputs });
    // …
  } catch (err) {
    if (err instanceof InsufficientTokensError) {
      setOutOfTokens({ available: err.available, required: err.required });
      return; // do NOT show a generic error toast
    }
    toast.error("Report generation failed");
  }
}

return (
  <>
    {outOfTokens && (
      <OutOfTokensBanner
        available={outOfTokens.available}
        required={outOfTokens.required}
      />
    )}
    <ReportForm onSubmit={onSubmit} />
  </>
);
```

### 7c. Banner component

```tsx
// src/components/out-of-tokens-banner.tsx
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export function OutOfTokensBanner({
  available,
  required,
}: { available: number; required: number }) {
  const short = (required - available).toLocaleString();
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-semibold text-destructive">Out of report credits</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This report needs <strong>{required.toLocaleString()}</strong> tokens but
          you only have <strong>{available.toLocaleString()}</strong> available —
          you're short by <strong>{short}</strong>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/billing/topup">Top up credits</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/billing">Upgrade plan</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### 7d. Pre-flight guard (avoid the error entirely)

Before showing the report intake form, call `getBalance(userId)` and disable
the "Generate report" CTA when `balance.available < estimateTokens(form)`. Pair
with the same banner so the messaging is identical. The 401-style fallback in
`onSubmit` then only fires for race conditions (concurrent reports draining
balance between pre-flight and reserve).
