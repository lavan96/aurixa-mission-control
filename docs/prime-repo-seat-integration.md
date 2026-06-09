# Prime Repo — Seat Entitlement Integration

Drop-in prompt to wire the Prime repo (and any clone) into Mission Control's
seat entitlement API. Mirrors the existing token-metering integration.

---

## Drop-in prompt for the Prime repo's chat agent

> **Stack:** TanStack Start (`createServerFn` + server routes), Lovable Cloud
> (Supabase), RLS-enabled. **No** Supabase Edge Functions. Credentials live
> at `.aurixa/credentials.json` (already in place from token integration).

You are extending this app to enforce a **seat limit** controlled by Mission
Control. Implement the following:

### 1. `src/server/aurixa-seats.server.ts` (new)

Reads the existing `AURIXA_API_KEY` from the credentials loader. Exposes:

```ts
export type SeatReserveInput = {
  externalUserId: string; // typically the new auth.users.id or email
  email?: string;
  displayName?: string;
  idempotencyKey: string; // stable per signup attempt (uuid v4 ok)
};

export async function reserveSeat(
  input: SeatReserveInput,
): Promise<
  | { ok: true; seat_id: string; seats_remaining: number; status: string }
  | { ok: false; error: "seat_limit_reached"; seat_limit: number; seats_used: number; plan: string }
  | { ok: false; error: string }
>;

export async function commitSeat(seatId: string): Promise<{ ok: boolean }>;
export async function releaseSeat(
  externalUserId: string,
  reason?: string,
): Promise<{ ok: boolean }>;
export async function getSeatEntitlement(): Promise<{
  plan: { slug: string; name: string; seat_limit: number; device_limit_per_seat: number | null };
  seats_used: number;
  seats_remaining: number;
}>;
export async function listSeats(opts?: {
  status?: "reserved" | "active" | "removed";
  limit?: number;
  offset?: number;
}): Promise<{
  seats: Array<{
    id: string;
    external_user_id: string;
    email: string | null;
    status: string;
    created_at: string;
  }>;
  total: number;
}>;
```

All methods POST/GET to `${MISSION_CONTROL_URL}/api/public/seats/{reserve,commit,release,entitlement,list}`
with header `x-clone-api-key: <AURIXA_API_KEY>`. Same error envelope as the
token endpoints — HTTP 402 means `seat_limit_reached` (surface a clean upgrade
prompt, do not retry).

### 2. Hook into signup flow

In the **server function that creates a new user** (e.g. `signUp.functions.ts`):

```ts
// 1. Reserve before creating the auth user
const reservation = await reserveSeat({
  externalUserId: requestedEmail,
  email: requestedEmail,
  displayName: name,
  idempotencyKey: clientIdempotencyKey,
});
if (!reservation.ok) {
  if (reservation.error === "seat_limit_reached") {
    return { ok: false, code: "seat_limit", limit: reservation.seat_limit, used: reservation.seats_used };
  }
  throw new Error(reservation.error);
}

// 2. Create the auth user / profile as usual
const user = await supabaseAdmin.auth.admin.createUser({ email: requestedEmail, ... });

// 3. Commit on success; release on failure
if (user.error) {
  await releaseSeat(requestedEmail, "auth_user_create_failed");
  throw user.error;
}
await commitSeat(reservation.seat_id);
```

Client must generate `idempotencyKey` (uuid v4) and reuse across retries so
double-click doesn't burn two seats.

### 3. Hook into user deletion / deactivation

Whenever a user is hard-deleted, soft-deleted, or has their access fully
revoked, call `releaseSeat(externalUserId, "user_deleted")`. Idempotent —
safe to call multiple times.

### 4. Settings UI — `/settings/team` (new or extended)

Add a "Plan & seats" card:

- Current plan name + seat limit
- Progress bar: `seats_used / seat_limit`
- "Manage plan" link → opens Mission Control billing in a new tab
- List of seats from `listSeats({ status: "active" })` with email + joined date

Use `useQuery` against `getSeatEntitlement` and refresh after every signup/delete.

### 5. Webhook handler — `src/routes/api/public/aurixa/webhook.ts`

Extend the existing Mission Control webhook handler (the one already verifying
`x-mc-signature` for `tokens.*` events) to also handle:

- `seats.limit.approaching` — write a banner alert to `system_alerts`
- `seats.limit.reached` — block new signups in the UI, show upgrade CTA
- `seats.plan.changed` — invalidate the cached entitlement; refetch on next request

Reuse the existing HMAC-SHA256 verification (`process.env.AURIXA_WEBHOOK_SECRET`).

### 6. Acceptance criteria

1. Signing up the 5th user on the Starter plan returns HTTP 402, shows
   "Seat limit reached — upgrade to add more team members", and creates no
   auth user.
2. Deleting a user frees a seat — `getSeatEntitlement().seats_remaining`
   increments by 1 within 1s.
3. Switching Mission Control's plan from Starter→Growth via the MC dashboard
   raises the cap to 10 with no Prime-repo restart needed.
4. Two simultaneous signups racing on the last seat: exactly one succeeds,
   the other gets HTTP 402.
5. `idempotencyKey` reuse returns the original seat_id, never a second
   reservation.

### 7. Docs

Add `docs/mission-control-seats.md` describing:

- where credentials live (`.aurixa/credentials.json`)
- the 5 endpoints + their request/response shapes
- the signup integration snippet (above)
- how to test locally (call `getSeatEntitlement()` from a debug button)

---

## Mission Control side — API summary (for the Prime repo to call)

| Method | Path                            | Purpose                                  |
| -----: | ------------------------------- | ---------------------------------------- |
|   POST | `/api/public/seats/reserve`     | Reserve a seat (idempotent). 402 if full |
|   POST | `/api/public/seats/commit`      | Finalize a reservation after signup ok   |
|   POST | `/api/public/seats/release`     | Free a seat on user delete/deactivate    |
|    GET | `/api/public/seats/entitlement` | Current plan, cap, used, remaining       |
|    GET | `/api/public/seats/list`        | Paginated seat list (admin UI in clone)  |

All require `x-clone-api-key: mck_…` with scope `seats:manage`. Issue this
scope alongside `tokens:meter` and `clones:rotate` when minting clone API
keys (auto-provisioning code should be updated to include it).

Webhook events fired to subscribed endpoints:

- `seats.reserved`, `seats.committed`, `seats.released`
- `seats.limit.approaching` (≥80% used)
- `seats.limit.reached` (at cap)
- `seats.plan.changed`

All signed with the existing `x-mc-signature` HMAC-SHA256 scheme.
