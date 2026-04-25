// Per-clone override merge logic. Overrides live on the assignment row
// (`overrides` jsonb + `override_keys` text[]) and are merged on top of
// the profile's brand_config + report_contact at apply time.
//
// Pure / isomorphic — no Supabase imports — so the apply pipeline AND the
// preview UI can use the exact same merge function.
import type { BrandConfig, ReportContact } from "./types";

export type CloneOverrides = {
  brand_config?: Partial<BrandConfig>;
  report_contact?: Partial<ReportContact>;
};

export type MergedBundle = {
  brand_config: BrandConfig;
  report_contact: ReportContact;
  overrideKeys: string[];
};

/**
 * Merge a clone's overrides on top of the profile bundle. The override
 * value wins when the field is present (even if explicitly null).
 */
export function mergeOverrides(args: {
  brand_config: BrandConfig;
  report_contact: ReportContact;
  overrides: CloneOverrides | null | undefined;
}): MergedBundle {
  const overrides = args.overrides ?? {};
  const overrideKeys: string[] = [];

  const brand_config: BrandConfig = { ...args.brand_config };
  for (const [key, value] of Object.entries(overrides.brand_config ?? {})) {
    brand_config[key] = value;
    overrideKeys.push(`brand_config.${key}`);
  }

  const report_contact: ReportContact = { ...args.report_contact };
  for (const [key, value] of Object.entries(overrides.report_contact ?? {})) {
    report_contact[key] = value;
    overrideKeys.push(`report_contact.${key}`);
  }

  return { brand_config, report_contact, overrideKeys };
}

/** Validate an overrides object — strips empty strings and unknown shapes. */
export function sanitizeOverrides(input: unknown): CloneOverrides {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const out: CloneOverrides = {};
  if (obj.brand_config && typeof obj.brand_config === "object") {
    out.brand_config = obj.brand_config as Partial<BrandConfig>;
  }
  if (obj.report_contact && typeof obj.report_contact === "object") {
    out.report_contact = obj.report_contact as Partial<ReportContact>;
  }
  return out;
}
