// AI conflict triage — when one or more cascade_results have failed, ask
// Lovable AI to inspect the error_message + diff_summary + clone context and
// propose either a fix-up commit (concrete steps) or a written escalation.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SupabaseLike = SupabaseClient<Database>;

export type TriageProposal = {
  cloneName: string;
  cloneId: string;
  resultId: string;
  category: "fixup" | "escalate";
  risk: "low" | "medium" | "high";
  title: string;
  steps: string[];
  rationale: string;
};

export type TriageResult =
  | { ok: true; proposals: TriageProposal[]; analyzed: number }
  | { ok: false; error: string };

const MAX_FAILURES = 8;

export async function triageCascadeFailures(
  supabase: SupabaseLike,
  cascadeEventId: string,
): Promise<TriageResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY not configured" };

  const [{ data: ev }, { data: results }] = await Promise.all([
    supabase
      .from("cascade_events")
      .select("id, mode, source_sha, source_branch, summary")
      .eq("id", cascadeEventId)
      .maybeSingle(),
    supabase
      .from("cascade_results")
      .select(
        "id, status, error_message, diff_summary, files_changed, clone:clones(id, name, github_owner, github_repo)",
      )
      .eq("cascade_event_id", cascadeEventId)
      .eq("status", "failed")
      .limit(MAX_FAILURES),
  ]);
  if (!ev) return { ok: false, error: "Cascade event not found" };
  if (!results || results.length === 0) {
    return { ok: true, proposals: [], analyzed: 0 };
  }

  const failuresPayload = results
    .map((r) => {
      const clone = (
        r as { clone: { name: string; github_owner: string; github_repo: string } | null }
      ).clone;
      return {
        result_id: r.id,
        clone: clone ? `${clone.name} (${clone.github_owner}/${clone.github_repo})` : "unknown",
        clone_id: (r as { clone: { id: string } | null }).clone?.id ?? null,
        clone_name: clone?.name ?? "unknown",
        files_changed: r.files_changed,
        diff_summary: r.diff_summary ?? "",
        error_message: r.error_message ?? "",
      };
    })
    .filter((f) => f.clone_id);

  const systemPrompt =
    `You are a senior platform engineer triaging cascade failures across a fleet ` +
    `of git repositories. For EACH failed clone, decide whether it's a "fixup" ` +
    `(safe to retry with a small adjustment — branch reset, sync remote, retry mode) ` +
    `or an "escalate" (requires human judgment — protected branch rule, code conflict, ` +
    `permission issue). Provide short numbered steps and a one-line rationale. ` +
    `Be terse — operators are scanning quickly.`;

  const userPrompt =
    `Cascade ${ev.id.slice(0, 8)} mode=${ev.mode} source=${(ev.source_sha ?? "").slice(0, 7)}\n\n` +
    `Failures:\n${JSON.stringify(failuresPayload, null, 2)}`;

  const tool = {
    type: "function" as const,
    function: {
      name: "emit_triage",
      description: "Return one proposal per failed clone.",
      parameters: {
        type: "object",
        properties: {
          proposals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                clone_id: { type: "string" },
                result_id: { type: "string" },
                clone_name: { type: "string" },
                category: { type: "string", enum: ["fixup", "escalate"] },
                risk: { type: "string", enum: ["low", "medium", "high"] },
                title: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                rationale: { type: "string" },
              },
              required: [
                "clone_id",
                "result_id",
                "clone_name",
                "category",
                "risk",
                "title",
                "steps",
                "rationale",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["proposals"],
        additionalProperties: false,
      },
    },
  };

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_triage" } },
    }),
  });

  if (!aiRes.ok) {
    if (aiRes.status === 429)
      return { ok: false, error: "AI rate limit reached — try again in a minute." };
    if (aiRes.status === 402) {
      return {
        ok: false,
        error: "Lovable AI credits exhausted — top up under Settings → Workspace → Usage.",
      };
    }
    const txt = await aiRes.text();
    return { ok: false, error: `AI error ${aiRes.status}: ${txt.slice(0, 200)}` };
  }

  const json = (await aiRes.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
    }>;
  };
  const argStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argStr) return { ok: false, error: "AI returned no triage" };

  let parsed: {
    proposals?: Array<
      Omit<TriageProposal, "cloneName" | "cloneId" | "resultId"> & {
        clone_id: string;
        result_id: string;
        clone_name: string;
      }
    >;
  };
  try {
    parsed = JSON.parse(argStr);
  } catch {
    return { ok: false, error: "AI returned malformed triage" };
  }

  const proposals: TriageProposal[] = (parsed.proposals ?? []).map((p) => ({
    cloneId: p.clone_id,
    resultId: p.result_id,
    cloneName: p.clone_name,
    category: p.category,
    risk: p.risk,
    title: p.title,
    steps: Array.isArray(p.steps) ? p.steps : [],
    rationale: p.rationale,
  }));

  await supabase.from("audit_log").insert({
    action: "cascade.triaged",
    entity_type: "cascade_event",
    entity_id: cascadeEventId,
    metadata: { failures: failuresPayload.length, proposals: proposals.length },
  });

  return { ok: true, proposals, analyzed: failuresPayload.length };
}
