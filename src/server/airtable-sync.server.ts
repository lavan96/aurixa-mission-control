// Airtable → waitlist_leads mirror sync.
//
// Silent backfill + safety-net for the Aurixa Systems waitlist. The website's
// Make.com scenario is the primary source of truth (Airtable + realtime
// notification); this pulls Airtable directly so historical rows and any
// rows Make/webhook missed get mirrored into Mission Control. This path
// does NOT fan out notifications — only fresh browser/Make-forwarded leads
// (the /api/public/leads/capture endpoint) do that.
import crypto from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanLeadText, LEAD_MAX_TEXT_LENGTH } from "@/server/lead-capture.server";

const AIRTABLE_BASE_ID = "apptyShYE0yzL4IGB";
const AIRTABLE_TABLE = "Aurixa Waitlist";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/airtable";
const PAGE_SIZE = 100;

type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

type AirtablePage = {
  records: AirtableRecord[];
  offset?: string;
};

function pickField(fields: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    const v = fields[n];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function dedupeKeyFor(email: string, submittedAt: string | null): string | null {
  if (!submittedAt) return null;
  return crypto.createHash("sha256").update(`${email}|${submittedAt}`).digest("hex");
}

async function fetchAirtablePage(offset?: string): Promise<AirtablePage> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const airtableKey = process.env.AIRTABLE_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");
  if (!airtableKey) throw new Error("AIRTABLE_API_KEY not configured");

  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  if (offset) params.set("offset", offset);
  const url = `${GATEWAY_URL}/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}?${params}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": airtableKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as AirtablePage;
}

function mapRecord(rec: AirtableRecord) {
  const f = rec.fields;
  const first_name = cleanLeadText(pickField(f, "First Name"));
  const last_name = cleanLeadText(pickField(f, "Last Name"));
  const email = cleanLeadText(pickField(f, "Corporate Email")).toLowerCase();
  if (!first_name || !last_name || !email || !isEmail(email)) return null;

  const submittedRaw = cleanLeadText(pickField(f, "Date Added"));
  const submittedMs = submittedRaw ? Date.parse(submittedRaw) : NaN;
  const submitted_at = Number.isFinite(submittedMs)
    ? new Date(submittedMs).toISOString()
    : rec.createdTime;

  return {
    first_name,
    last_name,
    email,
    mobile_number:
      cleanLeadText(pickField(f, "Phone Number", "Phone", "Mobile Number", "Mobile")) || null,
    entity_name: cleanLeadText(pickField(f, "Entity Name")) || null,
    entity_classification: cleanLeadText(pickField(f, "Entity Classification")) || null,
    transaction_volume:
      cleanLeadText(pickField(f, "Annual Transactional Value", "Annual Origination Volume")) ||
      null,
    tech_stack_bottlenecks:
      cleanLeadText(pickField(f, "Current Bottlenecks"), LEAD_MAX_TEXT_LENGTH) || null,
    notes: cleanLeadText(pickField(f, "Notes"), LEAD_MAX_TEXT_LENGTH) || null,
    airtable_status: cleanLeadText(pickField(f, "Status")) || null,
    submitted_at,
    airtable_record_id: rec.id,
    airtable_created_time: rec.createdTime,
  };
}

export type AirtableSyncResult = {
  pages: number;
  fetched: number;
  inserted: number;
  skipped_duplicate: number;
  skipped_invalid: number;
  errors: number;
};

export async function syncAirtableWaitlist(): Promise<AirtableSyncResult> {
  const out: AirtableSyncResult = {
    pages: 0,
    fetched: 0,
    inserted: 0,
    skipped_duplicate: 0,
    skipped_invalid: 0,
    errors: 0,
  };

  let offset: string | undefined = undefined;
  do {
    const page = await fetchAirtablePage(offset);
    out.pages += 1;
    for (const rec of page.records) {
      out.fetched += 1;
      const mapped = mapRecord(rec);
      if (!mapped) {
        out.skipped_invalid += 1;
        continue;
      }

      const dedupe_key =
        dedupeKeyFor(mapped.email, mapped.submitted_at) ?? `airtable:${mapped.airtable_record_id}`;

      const { error } = await supabaseAdmin.from("waitlist_leads").insert({
        first_name: mapped.first_name,
        last_name: mapped.last_name,
        email: mapped.email,
        mobile_number: mapped.mobile_number,
        entity_name: mapped.entity_name,
        entity_classification: mapped.entity_classification,
        transaction_volume: mapped.transaction_volume,
        tech_stack_bottlenecks: mapped.tech_stack_bottlenecks,
        notes: mapped.notes,
        source: "airtable_mirror",
        page: null,
        submitted_at: mapped.submitted_at,
        dedupe_key,
        metadata: {
          channel: "airtable_mirror",
          airtable_record_id: mapped.airtable_record_id,
          airtable_created_time: mapped.airtable_created_time,
          ...(mapped.airtable_status ? { airtable_status: mapped.airtable_status } : {}),
        },
      });

      if (error) {
        if (error.code === "23505") {
          out.skipped_duplicate += 1;
        } else {
          out.errors += 1;
          console.error("airtable sync insert failed", { record: rec.id, error });
        }
      } else {
        out.inserted += 1;
      }
    }
    offset = page.offset;
  } while (offset);

  return out;
}
