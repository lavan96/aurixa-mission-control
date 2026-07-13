# Waitlist Lead Capture — Website ↔ Mission Control Tie-Up

The Aurixa Systems landing page (`aurixa-systems` repo, `/contact` waitlist
form) fires a Make.com webhook on every CTA submission, which stores the lead
in Airtable. This integration mirrors every one of those leads into Mission
Control so operators get:

1. **Historical view** — the `/leads` section lists every captured lead with
   filters (status, segment, volume bracket, free-text search), triage
   statuses, stat tiles, and CSV export.
2. **Live notification** — the moment a new lead lands, a `lead_captured`
   notification is inserted and fans out through the existing pipeline:
   notifications bell (realtime), `/notifications` inbox, toasts, and browser
   push (`push-fanout`). The `/leads` page itself also updates live via a
   Supabase realtime subscription.

## Architecture

```
Waitlist form (aurixa-systems /contact)
  │
  ├─ 1. POST Make.com webhook  ──────────► Airtable   (existing, unchanged)
  │       └─ optional: Make HTTP module ─► Mission Control ingest (secret)
  │
  └─ 2. on Make success, fire-and-forget ► Mission Control ingest (browser)

Mission Control ingest: POST /api/public/leads/capture
  ├─ insert into public.waitlist_leads   (dedupe on hash(email|submittedAt))
  ├─ insert `lead_captured` notification (realtime → bell/push/toasts)
  └─ insert audit_log entry              (action: lead.captured)
```

Both delivery paths may fire for the same submission; the dedupe key (SHA-256
of `email|submittedAt`) collapses them into a single lead row and a single
notification. The browser dual-write only happens **after** the Make webhook
succeeds, so Mission Control never records a lead that Airtable missed.

## Endpoint contract

`POST /api/public/leads/capture` accepts the exact payload the waitlist form
already sends to Make.com:

```json
{
  "directiveFirstName": "Jane",
  "directiveLastName": "Doe",
  "corporateEmail": "jane@firm.com.au",
  "mobileNumber": "+61412345678",
  "entityName": "Doe Property Group",
  "entityClassification": "buyers_agent",
  "annualOriginationTransactionVolume": "tier_2",
  "currentTechStackBottlenecks": "…",
  "source": "AURIXA Contact Waitlist Page",
  "page": "/contact",
  "submittedAt": "2026-07-13T00:00:00.000Z"
}
```

Generic aliases (`firstName`/`first_name`, `email`, …) are also accepted so a
Make.com HTTP module can map fields loosely. Responses: `201` stored,
`200 {duplicate: true}` already stored, `422` invalid, `403` bad origin,
`429` rate-limited.

### Auth model

- **Server-to-server (Make.com)** — send the `LEAD_CAPTURE_SECRET` value in
  the `x-lead-capture-secret` header (or as `Authorization: Bearer …`).
  Trusted requests bypass origin checks and rate limits.
- **Browser dual-write** — no secret (it would be public in the bundle).
  Instead the request must originate from an allow-listed Origin
  (`aurixasystems.com.au`, `www.`, `localhost:3000`, plus
  `LEAD_CAPTURE_ALLOWED_ORIGINS`), passes strict validation, and is subject
  to per-IP (8/10 min) and global (300/hr) rate limits.

## Setup checklist

1. Apply migration `20260713060000_waitlist_lead_capture.sql` (Supabase).
2. Set `LEAD_CAPTURE_SECRET` in the Mission Control server environment.
3. *(Recommended)* In the Make.com scenario, after the Airtable step add an
   HTTP module: `POST https://mission-control.aurixasystems.com.au/api/public/leads/capture`
   with header `x-lead-capture-secret: <LEAD_CAPTURE_SECRET>` and the webhook
   payload passed through as JSON. This guarantees delivery even for browsers
   that block the dual-write.
4. Deploy the updated landing page (`aurixa-systems`) — it dual-writes
   automatically; override the target with `VITE_MISSION_CONTROL_URL` if the
   Mission Control domain ever changes.

## Data & access

- Table: `public.waitlist_leads` (RLS: operators read/update/delete; inserts
  only via the service role through the ingest endpoint).
- Realtime: table is in the `supabase_realtime` publication.
- Notification kind: `lead_captured` (mutable per-operator in
  Settings → Notifications).
