
# Mission Control Dashboard — Plan

## What we're building
A single-operator dashboard that manages a "fleet" of cloned/forked instances of your prime codebase. The prime is the source of truth; updates cascade strictly downward. Each clone is also a Lovable project, optionally wrapped by Cloudflare on demand.

---

## Information you need to provide before/during build
1. **Prime repo GitHub URL** (owner/repo)
2. **GitHub authorization** — connect via GitHub during build (GitHub App install on the org that will own clones by default)
3. **Cloudflare API token** — only when you first use a Cloudflare action (we won't ask up front)
4. **Lovable connection** — for spinning up new Lovable projects programmatically when cloning

---

## Core concepts (mental model)

- **Prime** — the source-of-truth repo. Read/write here only.
- **Clone** — a child instance. One clone = one GitHub repo + one Lovable project (+ optional Cloudflare). Clones are downstream-only; nothing flows back up.
- **Module** — a logical slice of the codebase (auth, billing, marketing-pages, etc.). AI auto-detects boundaries from prime; you approve & edit.
- **Cascade** — a one-direction push of changes from prime → selected clones. Three flavors per cascade event: PR, auto-merge, or notify-only. Granular (one clone) or bulk (all/tagged).

---

## V1 Features

### 1. Fleet Overview (home)
- Grid/list of all clones with: name, provisioning method (fork / template / clone), Lovable project link, GitHub link, deploy URL, Cloudflare status, sync status (in-sync / N commits behind / cascading), last cascade timestamp, tags.
- Filters: by tag, by sync status, by module set.
- Bulk-select for cascade actions.

### 2. Provisioning a New Clone
- "New Clone" wizard:
  - Name + tags
  - **Provisioning method picker** with tooltip explainers for all three (Fork / Template Repo / Independent Clone), with a recommended badge based on context (e.g., "Recommended for client-isolated deployments: Template Repo")
  - Owner: your org (default) or transfer-to email
  - Module selection (drag modules from the catalog into an "include" tray; the rest are excluded at injection time)
  - Optional Cloudflare wrapper toggle (deferred config)
- On submit: creates GitHub repo → strips/keeps modules per selection → creates linked Lovable project → registers in dashboard.

### 3. Module Catalog & Drag-Drop Injector
- AI-assisted module detection runs on the prime repo: scans folders, routes, imports, and proposes module boundaries with file lists. You approve, edit, rename, or merge proposals.
- Visual builder per clone:
  - Left: module palette (catalog from prime)
  - Right: clone's current module set
  - Drag a module in → AI generates the injection commit (adds files, wires routes, updates manifest) and pushes to the clone's repo, triggering its Lovable project to redeploy.
  - Drag out → AI generates the removal commit (deletes files, unwires routes) and pushes.
- Every clone carries a `modules.json` manifest so the dashboard knows what's installed without re-scanning.

### 4. Cascade Engine (waterfall updates)
- Triggered when prime gets a new commit, manually, or on a schedule.
- For each cascade event you choose:
  - **Scope**: all clones / tagged group / individual selection
  - **Mode**: open PR, auto-merge, or notify-only
  - **Filter**: smart per-module — only apply file changes belonging to modules each clone has installed
- Live progress view: per-clone status (queued → pushing → succeeded/failed/PR-opened), with diff preview and links to GitHub.
- Cascade history log per clone and per event, with re-run/rollback actions.

### 5. AI Layer (uses Lovable AI Gateway, no setup)
Three capabilities, all in v1:
- **Module detection** — scans prime, proposes boundaries.
- **Code automation** — writes injection/removal commits, drafts cascade PR descriptions, summarizes diffs across clones.
- **Fleet manager** — background job that periodically inspects clones, flags drift from prime, suggests when to cascade, auto-resolves trivial differences (formatting, lockfile bumps).

### 6. Cloudflare Integration (on-demand)
- Per-clone "Add Cloudflare" action. First use prompts for API token (stored as a server secret).
- Capabilities surfaced as needed: WAF rules, bot protection, rate limiting, DDoS, optional Pages/Workers hosting swap. We don't pre-configure — each capability is one click from the clone's detail page.

### 7. Single-Operator Auth
- Just you/your team. Simple email login (Lovable Cloud auth). User-roles table for future-proofing (admin/editor) but no multi-tenant complexity in v1.

---

## Architecture (high level)
- **Frontend**: TanStack Start dashboard (this Lovable project)
- **Backend**: server functions for GitHub API, Lovable provisioning, Cloudflare API, AI Gateway calls
- **Database** (Lovable Cloud): `clones`, `modules`, `clone_modules`, `cascade_events`, `cascade_results`, `prime_config`, `audit_log`, `user_roles`
- **GitHub**: GitHub App installed on your org, fine-grained permissions for repo create/contents/PRs
- **AI**: Lovable AI Gateway (default `google/gemini-3-flash-preview`; reasoning-effort high for module detection & merge suggestions)
- **Background jobs**: scheduled server functions for drift detection & cascade queue

---

## Build sequence
1. Auth + DB schema + connect prime repo (GitHub App install, store config)
2. Fleet overview (read-only listing of any pre-existing clones)
3. Clone provisioning wizard (fork/template/clone with tooltips & recommendation)
4. AI module detection + module catalog approval UI
5. Drag-drop module injector + manifest writes
6. Cascade engine (PR/auto-merge/notify modes, smart per-module filter)
7. AI fleet manager background job (drift detection, suggestions)
8. Cloudflare on-demand actions

---

## Out of scope for v1 (explicit)
- Upward syncing from clones to prime (architectural rule: never)
- Multi-tenant / public sign-up
- Manual conflict resolution UI (clones can't conflict — prime always wins)
- Payment/billing for clones

---

# Post-V1 Roadmap (phased enhancements)

You've already shipped the core fleet/cascade/module/drift/notifications stack with simulated GitHub. Below is a pragmatic, dependency-ordered plan grouped into five phases. Each phase delivers standalone value, and later phases unlock real-world execution.

## Phase 1 — Tighten the loop you already have (1–2 sessions)
Polish flows that exist before adding more surface area.

- **URL-synced filters everywhere** — extend the TanStack `validateSearch` pattern from `/notifications` to `/audit-log`, `/fleet-manager`, and `/cascades` so every view is shareable and refresh-safe.
- **Notification preferences** — per-kind/severity mute table (`notification_preferences`) honored by the bell, toasts, browser notifications, and (later) Web Push fan-out.
- **Cascade detail enhancements** — live diff preview (`files_changed` already tracked), per-result retry-with-different-mode, and a "rollback" stub that creates a reverse cascade event.
- **Bulk mark-all-read across all pages** on `/notifications` matching current filters (with confirm dialog).
- **Empty-state polish & loading skeletons** — every list page gets a proper zero-state and shimmer skeleton.

## Phase 2 — Real GitHub wiring (1 large session)
The single biggest unlock. Replace simulation with Octokit.

- **GitHub App secrets**: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`.
- **Server functions**: `provisionClone` (fork/template/clone), `pushModuleInjection`, `pushModuleRemoval`, `openCascadePR`, `mergeCascadePR`, `fetchCommitsBehind`.
- **Webhook receiver** at `/api/github/webhook` (push events on prime → auto-create cascade event in user's default mode).
- **Real drift detection** — replace the simulated `fleet-drift` job with `compare commits` API to compute actual `commits_behind` and changed file lists per clone.
- **PR status polling** — background job updates `cascade_results.status` from `pr_opened` → `succeeded` when the PR merges.
- **Rate-limit aware queue** — respect GitHub's 5000/hr with backoff and a visible quota meter.

## Phase 3 — Closed-tab Web Push (deferred from earlier)
Ship the pipeline you already started.

- VAPID secrets + service worker registration + push fan-out server function (the migration is already in place).
- Wire it into the existing `notifications` insert trigger so every kind that respects the user's preferences (Phase 1) fires push.
- Per-device subscription management page under `/settings`.

## Phase 4 — Operator productivity (1–2 sessions)
Make daily use faster.

- **Command palette** (⌘K) — jump to any clone/module/cascade, fire common actions (new clone, run drift scan, fire cascade), keyboard-driven mode switcher.
- **Saved cascade templates** — name + reuse common scope/mode combos ("Stage all tagged `client-*` clones, PR mode").
- **Scheduled cascades** — cron-style `cascade_schedules` table executed by a recurring server function (e.g., "every Sunday 2am, auto-merge to staging clones").
- **Inline diff viewer** on cascade results using `react-diff-viewer-continued`, fed by the GitHub `compare` API.
- **Tag manager** — bulk add/remove tags on selected clones; tag-based scope picker on the cascade form.

## Phase 5 — Intelligence & safety (2 sessions)
Lean on the AI Gateway harder, add guardrails.

- **AI cascade summaries** — before firing, Gemini summarizes the prime diff and predicts which clones it actually affects based on installed modules.
- **AI conflict triage** — when a cascade fails, AI inspects the failure and proposes a fix-up commit or escalates with a written reason.
- **Pre-cascade dry run** — simulates against each clone's `modules.json` and shows a green/yellow/red impact matrix.
- **Approval gates** — for high-blast-radius cascades (>N clones or auto-merge mode), require a second-operator approval recorded in `audit_log`.
- **Cloudflare on-demand actions** (the Phase 8 item from the original plan) — WAF rules, rate limiting, bot protection, surfaced per-clone after API token capture.
- **Per-clone health card** — uptime ping, last successful deploy, AI-summarized recent activity.

## Recommended execution order
1. **Phase 1** (low-risk polish, immediately better UX)
2. **Phase 2** (replaces the biggest piece of simulation — everything downstream becomes real)
3. **Phase 3** (now push notifications represent real events)
4. **Phase 4** (productivity multipliers once the system is real)
5. **Phase 5** (intelligence + safety once you trust the engine)
