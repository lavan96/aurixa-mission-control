// Centralized Lovable AI Gateway helper with usage logging.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AiCallArgs = {
  feature: string;
  model?: string;
  system?: string;
  prompt: string;
  json?: boolean;
  userId?: string | null;
  supabase?: SupabaseClient<Database>;
};

export async function callAi(args: AiCallArgs): Promise<{ content: string; tokens: number }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const model = args.model ?? "google/gemini-3-flash-preview";
  const messages = [
    ...(args.system ? [{ role: "system", content: args.system }] : []),
    { role: "user", content: args.prompt },
  ];
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(args.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage ?? {};
  const total = Number(usage.total_tokens ?? 0);

  if (args.supabase) {
    args.supabase
      .from("ai_usage_log")
      .insert({
        feature: args.feature,
        model,
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        total_tokens: total || null,
        user_id: args.userId ?? null,
      })
      .then(() => undefined, () => undefined);
  }
  return { content, tokens: total };
}
