// Pure helpers for the waitlist lead-capture ingest endpoint
// (/api/public/leads/capture). Kept free of I/O so they're unit-testable.
import crypto from "crypto";

export const LEAD_MAX_FIELD_LENGTH = 300;
export const LEAD_MAX_TEXT_LENGTH = 4000;

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Strip control characters, collapse whitespace, cap length.
export function cleanLeadText(value: unknown, max = LEAD_MAX_FIELD_LENGTH): string {
  if (typeof value !== "string") return "";
  return (
    value
      // eslint-disable-next-line no-control-regex -- stripping control chars is the point
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
  );
}

// Accept both the landing page's camelCase field names and generic
// snake_case/plain aliases so a Make.com HTTP module can map fields loosely.
function pick(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = payload[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export type ParsedLead = {
  first_name: string;
  last_name: string;
  email: string;
  mobile_number: string | null;
  entity_name: string | null;
  entity_classification: string | null;
  transaction_volume: string | null;
  tech_stack_bottlenecks: string | null;
  source: string;
  page: string | null;
  submitted_at: string | null;
};

export function parseLead(payload: Record<string, unknown>): ParsedLead | { error: string } {
  const first_name = cleanLeadText(pick(payload, "directiveFirstName", "firstName", "first_name"));
  const last_name = cleanLeadText(pick(payload, "directiveLastName", "lastName", "last_name"));
  const email = cleanLeadText(
    pick(payload, "corporateEmail", "email", "corporate_email"),
  ).toLowerCase();

  if (!first_name || !last_name) return { error: "missing_name" };
  if (!email || !isValidEmail(email)) return { error: "invalid_email" };

  const submittedRaw = cleanLeadText(pick(payload, "submittedAt", "submitted_at"));
  const submittedMs = submittedRaw ? Date.parse(submittedRaw) : NaN;
  const submitted_at = Number.isFinite(submittedMs) ? new Date(submittedMs).toISOString() : null;

  return {
    first_name,
    last_name,
    email,
    mobile_number: cleanLeadText(pick(payload, "mobileNumber", "mobile_number", "phone")) || null,
    entity_name: cleanLeadText(pick(payload, "entityName", "entity_name", "company")) || null,
    entity_classification:
      cleanLeadText(pick(payload, "entityClassification", "entity_classification")) || null,
    transaction_volume:
      cleanLeadText(
        pick(
          payload,
          "annualOriginationTransactionVolume",
          "transactionVolume",
          "transaction_volume",
        ),
      ) || null,
    tech_stack_bottlenecks:
      cleanLeadText(
        pick(payload, "currentTechStackBottlenecks", "techStackBottlenecks", "bottlenecks"),
        LEAD_MAX_TEXT_LENGTH,
      ) || null,
    source: cleanLeadText(pick(payload, "source")) || "unknown",
    page: cleanLeadText(pick(payload, "page")) || null,
    submitted_at,
  };
}

// Same submission delivered via the browser dual-write AND the Make.com
// forward hashes to the same key, so it lands exactly once.
export function dedupeKeyFor(lead: ParsedLead): string | null {
  if (!lead.submitted_at) return null;
  return crypto.createHash("sha256").update(`${lead.email}|${lead.submitted_at}`).digest("hex");
}
