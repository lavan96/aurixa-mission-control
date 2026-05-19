# Device Limit Integration (clone side)

Mission Control enforces a **per-seat device cap** defined by each clone's seat plan
(Starter 2 / Growth 3 / Pro 5 / Enterprise 10 by default; see `seat_plans.device_limit_per_seat`).

Add this to your clone (e.g. Prime repo) on top of the existing seat reserve/commit flow.

## 1. Device fingerprint

Generate a stable per-browser fingerprint on first load and persist it in
`localStorage` (also send it back on every sign-in). Don't reinvent — combine:

```ts
// src/lib/device-fingerprint.ts
export function getDeviceFingerprint(): string {
  const KEY = "aurixa.device.fp";
  let fp = localStorage.getItem(KEY);
  if (fp) return fp;
  const seed = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    crypto.randomUUID(),
  ].join("|");
  fp = btoa(seed).replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  localStorage.setItem(KEY, fp);
  return fp;
}

export function getDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}
```

## 2. Server functions

Add these to your existing `src/server/aurixa-client.server.ts` (or wherever the
seat client lives):

```ts
const MC_BASE = process.env.AURIXA_MISSION_CONTROL_URL!; // e.g. https://aurixa-mission-control.lovable.app
const API_KEY = await loadAurixaApiKey();                // from .aurixa/credentials.json

export async function registerDevice(input: {
  external_user_id: string;
  device_fingerprint: string;
  device_label?: string;
  user_agent?: string;
  platform?: string;
}) {
  const r = await fetch(`${MC_BASE}/api/public/seats/devices/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-clone-api-key": API_KEY },
    body: JSON.stringify(input),
  });
  const body = await r.json();
  if (r.status === 402) throw new DeviceLimitError(body);
  if (!r.ok) throw new Error(body.error ?? "device_register_failed");
  return body as { ok: true; device_id: string; devices_active: number; device_limit: number };
}

export async function heartbeatDevice(device_id: string) {
  await fetch(`${MC_BASE}/api/public/seats/devices/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-clone-api-key": API_KEY },
    body: JSON.stringify({ device_id }),
  });
}

export async function releaseDevice(input: {
  device_id?: string;
  external_user_id?: string;
  device_fingerprint?: string;
  reason?: string;
}) {
  await fetch(`${MC_BASE}/api/public/seats/devices/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-clone-api-key": API_KEY },
    body: JSON.stringify(input),
  });
}

export class DeviceLimitError extends Error {
  constructor(public payload: { devices_active: number; device_limit: number }) {
    super(`device_limit_reached (${payload.devices_active}/${payload.device_limit})`);
  }
}
```

## 3. Wire into auth flow

**On sign-in (after seat commit succeeds):**

```ts
const fp = getDeviceFingerprint();
const { device_id } = await registerDevice({
  external_user_id: user.id,
  device_fingerprint: fp,
  device_label: getDeviceLabel(),
  user_agent: navigator.userAgent,
  platform: navigator.platform,
});
// Store device_id in session/jwt so heartbeats and explicit logout work.
sessionStorage.setItem("aurixa.device.id", device_id);
```

**On 402 device_limit_reached:** show a "Manage devices" screen listing the
user's active devices (call `GET /api/public/seats/devices/list?external_user_id=...`)
and let them revoke one before retrying sign-in.

**On every page load (background):**

```ts
const id = sessionStorage.getItem("aurixa.device.id");
if (id) setInterval(() => heartbeatDevice(id), 5 * 60 * 1000); // every 5 min
```

**On sign-out / user delete:**

```ts
await releaseDevice({ device_id: sessionStorage.getItem("aurixa.device.id")! });
```

## 4. Acceptance criteria

- Signing in from device #1 with Starter plan: succeeds, `devices_active = 1`.
- Signing in from device #2 (same user, different fingerprint): succeeds, `devices_active = 2`.
- Signing in from device #3: receives HTTP 402 with `error: "device_limit_reached"`.
- Revoking device #1 (via MC `/billing/seats` or clone-side UI) → device #3 sign-in now succeeds.
- Mission Control `/billing/seats` "Active devices" table shows all active devices and supports manual revoke.

## 5. Webhooks (optional)

Subscribe to these events in your webhook receiver:

- `devices.registered` — `{ device_id, external_user_id, devices_active }`
- `devices.released` — `{ device_id }`
- `devices.limit.reached` — `{ external_user_id, devices_active, device_limit }`

Same HMAC signature scheme as the existing `seats.*` and `tokens.*` webhooks.
