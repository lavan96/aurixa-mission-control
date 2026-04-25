// Server-only branding engine. Owns:
//  - canonical hashing of brand bundles
//  - building the SQL that writes whitelabel_settings + report contact
//    into a clone backend
//  - mirroring brand assets from Mission Control storage into a clone's
//    own Supabase Storage so the clone is self-sufficient
//
// Pure helpers + DB-touching helpers. Server functions in branding.functions.ts
// wrap these with auth middleware. The applyBrandToClone path is also reusable
// from cron / cascade-engine if we want auto-rebrand on upgrade.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import type { Database } from "@/integrations/supabase/types";
import { runSqlOnProject } from "./backend-provisioning.server";

type SupabaseLike = SupabaseClient<Database>;

// ─── Types ────────────────────────────────────────────────────────────

export type BrandConfig = {
  // Mirrors prime's whitelabel_settings JSONB shape. Loose typing on purpose:
  // the prime owns the canonical schema; we just cascade the bundle.
  brand_name?: string | null;
  tagline?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  background_color?: string | null;
  foreground_color?: string | null;
  font_family?: string | null;
  logo_light_url?: string | null;
  logo_dark_url?: string | null;
  favicon_url?: string | null;
  email_signature_html?: string | null;
  email_signature_text?: string | null;
  support_url?: string | null;
  privacy_url?: string | null;
  terms_url?: string | null;
  // Open shape — anything else the prime defines.
  [key: string]: unknown;
};

export type ReportContact = {
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contact_address?: string | null;
  contact_website?: string | null;
  [key: string]: unknown;
};

export type BrandAsset = {
  // Path in our brand-assets bucket, e.g. "profiles/<id>/logo-light.png"
  source_path: string;
  // Where it should land in the clone's storage, e.g. "branding/logo-light.png"
  target_path: string;
  // MIME for upload
  content_type: string;
  // Field on brand_config to update with the final clone-side public URL
  // (e.g. "logo_light_url"). null means "don't rewrite, just mirror".
  config_field: keyof BrandConfig | null;
};

// ─── Hashing ─────────────────────────────────────────────────────────

/** Stable JSON stringify (sorted keys) so equivalent configs hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashBrandBundle(bundle: {
  brand_config: BrandConfig;
  report_contact: ReportContact;
  asset_manifest?: BrandAsset[];
}): string {
  const canonical = stableStringify({
    brand_config: bundle.brand_config,
    report_contact: bundle.report_contact,
    asset_manifest: bundle.asset_manifest ?? [],
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

// ─── SQL builder ─────────────────────────────────────────────────────

/**
 * Escape a JSON value for safe inlining inside a Postgres SQL string.
 * We use $brand$ dollar-quoting to avoid escaping headaches; we sanitise the
 * payload to ensure the delimiter cannot appear inside it.
 */
function jsonbLiteral(value: unknown): string {
  const json = JSON.stringify(value).replace(/\$brand\$/g, "");
  return `$brand$${json}$brand$::jsonb`;
}

/**
 * Build the SQL we run against a clone backend to apply the brand bundle.
 * Tables `whitelabel_settings` and `global_report_settings` follow the prime
 * schema (single row each, identified by `is_active = true` or by id=1).
 *
 * We use UPSERT semantics: try update, fall back to insert if no row exists.
 * The clone's prime schema controls the table layout — we only set the
 * columns we know about and leave the rest untouched.
 */
export function buildApplySql(args: {
  brand_config: BrandConfig;
  report_contact: ReportContact;
  config_hash: string;
}): string {
  const { brand_config, report_contact, config_hash } = args;

  const wlPayload = jsonbLiteral({ ...brand_config, _aurixa_hash: config_hash });
  const rcPayload = jsonbLiteral(report_contact);

  return `
-- Aurixa branding cascade — hash:${config_hash}
DO $$
DECLARE
  _wl_exists boolean;
  _rs_exists boolean;
BEGIN
  -- whitelabel_settings: merge into the active row, or insert one
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='whitelabel_settings') THEN
    SELECT EXISTS(SELECT 1 FROM public.whitelabel_settings) INTO _wl_exists;
    IF _wl_exists THEN
      UPDATE public.whitelabel_settings
      SET settings = COALESCE(settings, '{}'::jsonb) || ${wlPayload},
          updated_at = now()
      WHERE id = (SELECT id FROM public.whitelabel_settings ORDER BY updated_at DESC NULLS LAST LIMIT 1);
    ELSE
      INSERT INTO public.whitelabel_settings (settings) VALUES (${wlPayload});
    END IF;
  END IF;

  -- global_report_settings.contact_details: same merge pattern
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='global_report_settings') THEN
    SELECT EXISTS(SELECT 1 FROM public.global_report_settings) INTO _rs_exists;
    IF _rs_exists THEN
      UPDATE public.global_report_settings
      SET contact_details = COALESCE(contact_details, '{}'::jsonb) || ${rcPayload},
          updated_at = now()
      WHERE id = (SELECT id FROM public.global_report_settings ORDER BY updated_at DESC NULLS LAST LIMIT 1);
    ELSE
      INSERT INTO public.global_report_settings (contact_details) VALUES (${rcPayload});
    END IF;
  END IF;
END $$;
`;
}

// ─── Asset mirroring ─────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Download an asset from Mission Control's brand-assets bucket using the
 * service role, then upload it into the clone's own Storage bucket using
 * the clone's service_role_key. Returns the clone-side public URL.
 *
 * Best-effort: missing source files or upload errors are reported per-asset
 * but never block a brand cascade. The text bundle (colors/copy) still lands.
 */
export async function mirrorAssetsToClone(args: {
  cloneSupabaseUrl: string;
  cloneServiceRoleKey: string;
  cloneBucket: string;
  assets: BrandAsset[];
}): Promise<{
  uploaded: Array<{ asset: BrandAsset; public_url: string }>;
  failed: Array<{ asset: BrandAsset; error: string }>;
}> {
  const uploaded: Array<{ asset: BrandAsset; public_url: string }> = [];
  const failed: Array<{ asset: BrandAsset; error: string }> = [];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    for (const a of args.assets) {
      failed.push({ asset: a, error: "Mission Control storage credentials missing" });
    }
    return { uploaded, failed };
  }

  for (const asset of args.assets) {
    try {
      // 1. Download from Mission Control bucket (service-role auth bypasses RLS)
      const dlRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/brand-assets/${encodeURI(asset.source_path)}`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (!dlRes.ok) {
        failed.push({
          asset,
          error: `Source download failed: ${dlRes.status} ${dlRes.statusText}`,
        });
        continue;
      }
      const blob = await dlRes.arrayBuffer();

      // 2. Upload to the clone's storage with upsert
      const upRes = await fetch(
        `${args.cloneSupabaseUrl}/storage/v1/object/${args.cloneBucket}/${encodeURI(asset.target_path)}`,
        {
          method: "POST",
          headers: {
            apikey: args.cloneServiceRoleKey,
            Authorization: `Bearer ${args.cloneServiceRoleKey}`,
            "Content-Type": asset.content_type,
            "x-upsert": "true",
          },
          body: blob,
        },
      );
      if (!upRes.ok) {
        const txt = await upRes.text();
        failed.push({ asset, error: `Clone upload failed: ${upRes.status} — ${txt.slice(0, 200)}` });
        continue;
      }

      const publicUrl = `${args.cloneSupabaseUrl}/storage/v1/object/public/${args.cloneBucket}/${encodeURI(asset.target_path)}`;
      uploaded.push({ asset, public_url: publicUrl });
    } catch (err) {
      failed.push({
        asset,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { uploaded, failed };
}

// ─── Apply pipeline ───────────────────────────────────────────────────

export type ApplyBrandResult =
  | {
      ok: true;
      cloneId: string;
      profileId: string;
      profileVersion: number;
      configHash: string;
      assetsUploaded: number;
      assetsFailed: number;
      durationMs: number;
    }
  | {
      ok: false;
      cloneId: string;
      profileId: string;
      error: string;
      durationMs: number;
    };

/**
 * Apply a brand profile to a single clone end-to-end:
 *  1. Resolve the clone's backend (must be `ready`).
 *  2. Mirror assets to the clone's brand-assets bucket.
 *  3. Rewrite asset URLs in the brand config to clone-side URLs.
 *  4. Run the merge SQL against the clone's database.
 *  5. Update the assignment row + append a history entry.
 *
 * Re-usable: cron, cascade engine, and the UI all call into this.
 */
export async function applyBrandToClone(
  supabase: SupabaseLike,
  args: {
    cloneId: string;
    profileId: string;
    actorUserId: string | null;
    cascadeEventId?: string | null;
  },
): Promise<ApplyBrandResult> {
  const startedAt = Date.now();

  // 1. Load profile + clone backend in parallel
  const [profileRes, backendRes] = await Promise.all([
    supabase
      .from("clone_brand_profiles")
      .select("id, version, brand_config, report_contact, asset_manifest, status")
      .eq("id", args.profileId)
      .maybeSingle(),
    supabase
      .from("clone_backends")
      .select("supabase_project_ref, supabase_url, service_role_key, status")
      .eq("clone_id", args.cloneId)
      .maybeSingle(),
  ]);

  const profile = profileRes.data;
  const backend = backendRes.data;

  const fail = async (error: string): Promise<ApplyBrandResult> => {
    const durationMs = Date.now() - startedAt;
    await supabase
      .from("clone_brand_assignments")
      .upsert(
        {
          clone_id: args.cloneId,
          profile_id: args.profileId,
          status: "failed",
          error_message: error,
          last_drift_check_at: new Date().toISOString(),
        },
        { onConflict: "clone_id" },
      );
    await supabase.from("clone_brand_history").insert({
      clone_id: args.cloneId,
      profile_id: args.profileId,
      profile_version: profile?.version ?? null,
      config_snapshot: {},
      status: "failed",
      pushed_by: args.actorUserId,
      cascade_event_id: args.cascadeEventId ?? null,
      error_message: error,
      duration_ms: durationMs,
    });
    return {
      ok: false,
      cloneId: args.cloneId,
      profileId: args.profileId,
      error,
      durationMs,
    };
  };

  if (profileRes.error || !profile) return fail(profileRes.error?.message ?? "Brand profile not found");
  if (profile.status !== "published")
    return fail(`Profile is not published (status: ${profile.status})`);
  if (backendRes.error || !backend) return fail("Clone backend not found");
  if (backend.status !== "ready")
    return fail(`Clone backend not ready (status: ${backend.status})`);
  if (!backend.supabase_url || !backend.service_role_key || !backend.supabase_project_ref)
    return fail("Clone backend credentials incomplete");

  // 2. Mirror assets
  const assets = (profile.asset_manifest as unknown as BrandAsset[]) ?? [];
  const mirror = await mirrorAssetsToClone({
    cloneSupabaseUrl: backend.supabase_url,
    cloneServiceRoleKey: backend.service_role_key,
    cloneBucket: "branding",
    assets,
  });

  // 3. Rewrite asset URLs in the brand config
  const brandConfig: BrandConfig = { ...((profile.brand_config as BrandConfig) ?? {}) };
  for (const u of mirror.uploaded) {
    if (u.asset.config_field) {
      brandConfig[u.asset.config_field] = u.public_url;
    }
  }
  const reportContact: ReportContact = (profile.report_contact as ReportContact) ?? {};
  const finalHash = hashBrandBundle({
    brand_config: brandConfig,
    report_contact: reportContact,
    asset_manifest: assets,
  });

  // 4. Run merge SQL on the clone backend
  try {
    const sql = buildApplySql({
      brand_config: brandConfig,
      report_contact: reportContact,
      config_hash: finalHash,
    });
    await runSqlOnProject(backend.supabase_project_ref, sql);
  } catch (err) {
    return fail(`SQL apply failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Update assignment + append history
  const durationMs = Date.now() - startedAt;
  const nowIso = new Date().toISOString();
  await supabase
    .from("clone_brand_assignments")
    .upsert(
      {
        clone_id: args.cloneId,
        profile_id: args.profileId,
        status: "applied",
        applied_at: nowIso,
        applied_by: args.actorUserId,
        applied_config_hash: finalHash,
        last_drift_check_at: nowIso,
        drift_summary: null,
        error_message: null,
      },
      { onConflict: "clone_id" },
    );
  await supabase.from("clone_brand_history").insert({
    clone_id: args.cloneId,
    profile_id: args.profileId,
    profile_version: profile.version,
    config_snapshot: {
      brand_config: brandConfig,
      report_contact: reportContact,
    } as unknown as Database["public"]["Tables"]["clone_brand_history"]["Insert"]["config_snapshot"],
    config_hash: finalHash,
    status: "applied",
    pushed_by: args.actorUserId,
    cascade_event_id: args.cascadeEventId ?? null,
    duration_ms: durationMs,
  });

  return {
    ok: true,
    cloneId: args.cloneId,
    profileId: args.profileId,
    profileVersion: profile.version,
    configHash: finalHash,
    assetsUploaded: mirror.uploaded.length,
    assetsFailed: mirror.failed.length,
    durationMs,
  };
}

// ─── Drift scan (cron-callable) ──────────────────────────────────────

export type BrandDriftScanResult = {
  scanned: number;
  drifted: number;
  reapplied: number;
  failures: number;
  details: Array<{
    cloneId: string;
    profileId: string;
    reason: string;
    reapplied: boolean;
    error?: string;
  }>;
};

/**
 * Compare every assignment's applied_config_hash to its profile's current
 * config_hash. For mismatches, mark the assignment 'drifted' and notify.
 *
 * Cron-callable. Designed for the /hooks/brand-drift endpoint that pg_cron
 * pings every 30 min. Pure read + status update — does NOT auto-reapply,
 * since brand cascades are irreversible. Use a `brand_sync` schedule with
 * `clone_ids: "drifted"` for that.
 */
export async function runBrandDriftScan(
  supabase: SupabaseLike,
): Promise<BrandDriftScanResult> {
  const { data: rows, error } = await supabase
    .from("clone_brand_assignments")
    .select(
      "clone_id, profile_id, applied_config_hash, status, clone_brand_profiles(config_hash, status, name)",
    );
  if (error) {
    return { scanned: 0, drifted: 0, reapplied: 0, failures: 1, details: [] };
  }

  type Row = {
    clone_id: string;
    profile_id: string;
    applied_config_hash: string | null;
    status: Database["public"]["Enums"]["brand_assignment_status"];
    clone_brand_profiles: {
      config_hash: string | null;
      status: Database["public"]["Enums"]["brand_profile_status"];
      name: string;
    } | null;
  };

  const driftedIds: string[] = [];
  const details: BrandDriftScanResult["details"] = [];
  for (const r of (rows ?? []) as Row[]) {
    const profileHash = r.clone_brand_profiles?.config_hash ?? null;
    const profileStatus = r.clone_brand_profiles?.status ?? null;
    if (profileStatus !== "published") continue; // skip drafts/archived

    let reason: string | null = null;
    if (!r.applied_config_hash) reason = "Never applied";
    else if (profileHash && profileHash !== r.applied_config_hash)
      reason = "Profile updated since last apply";

    if (reason && r.status !== "drifted" && r.status !== "pending") {
      driftedIds.push(r.clone_id);
      details.push({
        cloneId: r.clone_id,
        profileId: r.profile_id,
        reason,
        reapplied: false,
      });
    }
  }

  if (driftedIds.length > 0) {
    await supabase
      .from("clone_brand_assignments")
      .update({
        status: "drifted",
        last_drift_check_at: new Date().toISOString(),
        drift_summary: "Detected by automated drift scan",
      })
      .in("clone_id", driftedIds);

    // One umbrella notification — operators open /branding to act.
    await supabase.from("notifications").insert({
      kind: "drift_medium",
      severity: "warning",
      title: `Brand drift detected · ${driftedIds.length} clone(s)`,
      body: `${driftedIds.length} clone(s) have brand profile updates pending application.`,
      url: "/branding",
      metadata: {
        scope: "brand_drift_scan",
        drifted_count: driftedIds.length,
      },
    });
  }

  return {
    scanned: rows?.length ?? 0,
    drifted: driftedIds.length,
    reapplied: 0,
    failures: 0,
    details,
  };
}
