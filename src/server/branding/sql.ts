// Build the SQL we run against a clone backend to apply a brand bundle.
// Targets two prime-schema tables:
//   - whitelabel_settings        (jsonb 'settings' column)
//   - global_report_settings     (jsonb 'contact_details' column)
// UPSERT semantics: try update, fall back to insert if no row exists.
import type { BrandConfig, ReportContact } from "./types";

/**
 * Escape a JSON value for safe inlining inside a Postgres SQL string.
 * We use $brand$ dollar-quoting and sanitise the payload to ensure the
 * delimiter cannot appear inside it.
 */
function jsonbLiteral(value: unknown): string {
  const json = JSON.stringify(value).replace(/\$brand\$/g, "");
  return `$brand$${json}$brand$::jsonb`;
}

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
