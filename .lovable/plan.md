# Aurixa Mission Control — Gap Analysis & Max-Effort Enhancement Plan

After auditing routes, server functions, the database schema, and the original `.lovable/plan.md`, the platform is **substantially complete** through Phases 1–5 plus the white-label branding system (Phase 6). The remaining gaps cluster into four buckets: **Cloudflare integration is a stub**, **AI capabilities are under-leveraged**, **observability/analytics surfaces are thin**, and **several operator workflows lack end-to-end polish**.

---

## Identified Gaps

### 1. Cloudflare integration (highest-value gap)
`src/routes/cloudflare.tsx` is purely cosmetic — no API token capture, no real WAF/bot/rate-limit/DNS calls, no per-clone enable flow. The plan promised on-demand WAF rules, bot protection, rate limiting, and DDoS posture per clone.

### 2. AI Gateway under-utilized
- No **AI-driven cascade summaries** (Phase 5 promise) — there's a triage card for failures, but no pre-flight "what does this diff actually do" summarizer.
- No **AI brand-config validator** (contrast checks, accessibility hints, tone consistency).
- No **AI module-doc generator** for the library (operators write descriptions by hand).
- No **AI weekly fleet digest** that summarizes drift, cascades, and health into a readable narrative.

### 3. Observability / analytics
- No **fleet-wide metrics dashboard** (cascades/day, drift trend, push delivery rate, AI token usage).
- No **GitHub API rate-limit meter** despite the plan calling it out as visible.
- No **per-clone uptime sparkline** beyond a single snapshot — historical health timeline is missing from the clone detail view.
- **Push delivery telemetry** not surfaced (success/fail per device).

### 4. Operator workflow polish
- **Branding versions** can be rolled back but there's no **diff viewer between two versions** (what actually changed?).
- **Cascade approvals**: notification fires but there's no bulk-approve / batch-reject screen.
- **Audit log** lacks **CSV export** and **saved filter presets**.
- **Clone bulk operations**: tag/cascade exist; **bulk delete**, **bulk pause**, and **bulk re-provision-backend** do not.
- **Onboarding**: no guided first-run wizard for new operators (prime config → GitHub install → first clone).
- **Keyboard shortcuts** beyond ⌘K (e.g., `g d` for dashboard, `r` to refresh drift) — power-user moves.

### 5. Smaller items
- No **SLO/error-budget surface** for cascade success rate.
- **Brand drift** scans on schedule but UI lacks a **drift severity timeline chart**.
- **Module library** has approval flow but no **deprecation/sunset workflow** for retiring old versions.
- **Notification preferences** lack **digest mode** ("batch into hourly/daily summary").

---

## Implementation Plan (phased, maximum effort)

### Phase 7 — Cloudflare for real (1 large session)
**Goal**: replace the stub with a working integration.

- Migration: `cloudflare_accounts` (token reference, account_id, email), `cloudflare_clone_config` (clone_id, zone_id, plan, posture flags), `cloudflare_audit` (action log).
- Secret capture flow: `CLOUDFLARE_API_TOKEN` via `add_secret` on first use.
- Server module `src/server/cloudflare/` with Octokit-style typed client wrapping the CF v4 API: `listZones`, `attachZoneToClone`, `setSecurityLevel`, `applyWAFRule`, `setRateLimit`, `enableBotFightMode`, `getAnalytics(zoneId, range)`.
- Per-clone "Edge" tab on `/clones/$cloneId`: toggle WAF presets, sliders for rate limits, bot-mode switch, live 24h request/threats chart.
- `/cloudflare` becomes a real fleet-wide dashboard: total threats blocked, top zones, posture compliance matrix.

### Phase 8 — AI Layer Maximum (1 session)
- **Cascade summarizer**: pre-flight server fn calls Gemini with the prime diff + each clone's `modules.json`, returns markdown summary + impact prediction; surfaces in cascade form before "Fire".
- **Brand AI assistant**: contrast/AA validator, color-harmony suggestions, tone-of-voice check on email signature copy.
- **Module doc autofill**: AI fills `description`, `tags`, `route_path` hints when a module is proposed.
- **Weekly fleet digest**: scheduled server fn produces markdown digest, written to a new `fleet_digests` table and rendered on a `/digests` route.

### Phase 9 — Observability (1 session)
- New `/metrics` route with cards: cascades/day, success rate, drift severity timeline, push deliveries, AI token spend (track via `ai_usage_log` table).
- Persistent **GitHub rate-limit meter** in the app shell (poll `/rate_limit` every 60s).
- **Health timeline chart** on clone detail (read existing `clone_health_snapshots`, render last 30 days sparkline).
- **Push delivery telemetry**: extend `push-fanout` edge fn to log per-subscription result into `push_delivery_log`; surface success rate on `/settings/notifications`.

### Phase 10 — Operator UX Polish (1 session)
- **Brand version diff viewer**: side-by-side JSON diff (reuse `react-diff-viewer-continued`) on the version timeline.
- **Cascade approvals queue**: `/cascades/approvals` with bulk approve/reject + reason.
- **Audit log export**: CSV download honoring current filters; saved filter presets stored in `user_preferences`.
- **Bulk clone ops**: bulk delete (with confirm + cascade-event guard), bulk pause (sync_status `paused`), bulk re-provision backend.
- **First-run wizard**: `/onboarding` step-through (prime config → GitHub install → first clone → invite teammate).
- **Keyboard shortcuts** layer using `react-hotkeys-hook`; a `?` overlay shows the cheat sheet.

### Phase 11 — Reliability & lifecycle (smaller, ~½ session)
- **SLO surface**: rolling 7d cascade success rate + error budget on dashboard.
- **Module deprecation**: `module_library.deprecated_at` + warning badge in builder; auto-suggest replacement.
- **Notification digest mode**: per-user "batch hourly/daily" preference; scheduled fn drains pending notifications into a single email/push.
- **Brand drift severity chart**: 30-day stacked area on `/branding`.

---

## Technical Notes

- All new server fns follow the established `*.functions.ts` + `*.server.ts` split with `requireSupabaseAuth` middleware.
- All new tables get RLS (`is_operator` for read, `has_role(admin)` for destructive).
- AI calls go through Lovable AI Gateway; default `google/gemini-3-flash-preview`, escalate to `gemini-2.5-pro` for digests.
- New cron entries appended to `src/server/cron.ts` for digests, push retention, rate-limit polling.
- Cloudflare client wrapped to respect the same rate-limit/backoff pattern used for GitHub.
- All UI follows existing semantic tokens in `src/styles.css`; no raw hex.

---

## Recommended Execution Order
1. **Phase 7 — Cloudflare** (biggest tangible value, ships missing v1 promise).
2. **Phase 9 — Observability** (you'll want metrics before unleashing more AI).
3. **Phase 8 — AI Layer** (now has data to chew on).
4. **Phase 10 — Operator UX**.
5. **Phase 11 — Reliability & lifecycle**.

Each phase ships independently and leaves the system in a working state.