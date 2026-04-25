// Canonical hashing for brand bundles so equivalent configs hash identically.
import { createHash } from "crypto";
import type { BrandAsset, BrandConfig, ReportContact } from "./types";

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
