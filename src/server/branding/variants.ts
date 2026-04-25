// Asset variant pipeline.
//
// Workers SSR can't run sharp/canvas, so we lean on Supabase Storage's
// built-in image transformations (`?width=N&format=webp&quality=Q`) which
// are CDN-cached and generated on first request. This module just records
// which variants we *want* (DB-tracked) and exposes their public URLs.
//
// Standard variant set we register for every uploaded image asset:
//   - favicon: 16, 32, 48, 64, 192, 512 (PNG)
//   - logo:    1x (original), 2x (retina hint), webp variants for both
//   - any:     webp + original
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BrandAsset } from "./types";

type SupabaseLike = SupabaseClient<Database>;

export type VariantSpec = {
  kind: string;
  width?: number;
  height?: number;
  format?: "webp" | "png" | "jpg";
  quality?: number;
};

/** Default variant matrix per asset role. */
export function variantsForAsset(asset: BrandAsset): VariantSpec[] {
  const field = asset.config_field ?? "";
  if (String(field).includes("favicon")) {
    return [
      { kind: "favicon-16", width: 16, height: 16, format: "png" },
      { kind: "favicon-32", width: 32, height: 32, format: "png" },
      { kind: "favicon-48", width: 48, height: 48, format: "png" },
      { kind: "favicon-192", width: 192, height: 192, format: "png" },
      { kind: "favicon-512", width: 512, height: 512, format: "png" },
    ];
  }
  if (String(field).includes("logo")) {
    return [
      { kind: "logo-1x-webp", width: 480, format: "webp", quality: 85 },
      { kind: "logo-2x-webp", width: 960, format: "webp", quality: 85 },
      { kind: "logo-1x-png", width: 480, format: "png" },
      { kind: "logo-2x-png", width: 960, format: "png" },
    ];
  }
  // Generic image — webp + original
  return [
    { kind: "webp-medium", width: 800, format: "webp", quality: 85 },
    { kind: "webp-large", width: 1600, format: "webp", quality: 85 },
  ];
}

/** Build a Supabase Storage transform URL. */
export function buildTransformUrl(
  baseUrl: string,
  bucket: string,
  path: string,
  spec: VariantSpec,
): string {
  const params = new URLSearchParams();
  if (spec.width) params.set("width", String(spec.width));
  if (spec.height) params.set("height", String(spec.height));
  if (spec.format) params.set("format", spec.format);
  if (spec.quality) params.set("quality", String(spec.quality));
  const qs = params.toString();
  // /render/image/public/<bucket>/<path>?width=...
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/render/image/public/${bucket}/${encodeURI(path)}${qs ? `?${qs}` : ""}`;
}

/**
 * Register asset variants for a profile. Idempotent — uses upsert on
 * (profile_id, variant_path). Returns count + cache-bust token.
 */
export async function registerAssetVariants(
  supabase: SupabaseLike,
  args: {
    profileId: string;
    bucket?: string;
    assets: BrandAsset[];
    storageBaseUrl: string;
  },
): Promise<{ registered: number; cacheBust: string }> {
  const bucket = args.bucket ?? "brand-assets";
  const cacheBust = Date.now().toString(36);
  const rows: Database["public"]["Tables"]["clone_brand_asset_variants"]["Insert"][] = [];

  for (const asset of args.assets) {
    if (!asset.content_type?.startsWith("image/")) continue;
    const variants = variantsForAsset(asset);
    for (const spec of variants) {
      const variantPath = `${asset.source_path}__${spec.kind}`;
      const url = buildTransformUrl(args.storageBaseUrl, bucket, asset.source_path, spec) +
        (variantPath.includes("?") ? "&" : "?") + `v=${cacheBust}`;
      rows.push({
        profile_id: args.profileId,
        source_path: asset.source_path,
        variant_path: variantPath,
        variant_kind: spec.kind,
        width: spec.width ?? null,
        height: spec.height ?? null,
        content_type: spec.format ? `image/${spec.format}` : asset.content_type,
        public_url: url,
      });
    }
  }

  if (rows.length === 0) return { registered: 0, cacheBust };

  const { error } = await supabase
    .from("clone_brand_asset_variants")
    .upsert(rows, { onConflict: "profile_id,variant_path" });
  if (error) {
    return { registered: 0, cacheBust };
  }
  return { registered: rows.length, cacheBust };
}

/**
 * Delete all variants for a profile (used on profile delete cascade or
 * when assets are entirely re-uploaded).
 */
export async function clearAssetVariants(
  supabase: SupabaseLike,
  profileId: string,
): Promise<void> {
  await supabase
    .from("clone_brand_asset_variants")
    .delete()
    .eq("profile_id", profileId);
}
