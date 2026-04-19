import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// AI-powered module detection from a (mocked) prime repo file tree.
// Calls Lovable AI Gateway with reasoning: high to propose module boundaries.
// Wire real GitHub tree fetch later — for now uses a representative tree
// derived from prime_config so the AI output is grounded.

type Proposed = {
  name: string;
  slug: string;
  description: string;
  file_globs: string[];
  routes: string[];
  ai_confidence: number;
};

const FALLBACK_TREE = [
  "src/routes/index.tsx",
  "src/routes/auth.tsx",
  "src/routes/dashboard.tsx",
  "src/routes/settings.tsx",
  "src/routes/billing.tsx",
  "src/routes/about.tsx",
  "src/routes/pricing.tsx",
  "src/routes/contact.tsx",
  "src/routes/blog.index.tsx",
  "src/routes/blog.$slug.tsx",
  "src/components/app-shell.tsx",
  "src/components/protected-route.tsx",
  "src/lib/auth.tsx",
  "src/lib/queries.ts",
  "src/integrations/supabase/client.ts",
  "supabase/functions/stripe-webhook/index.ts",
  "supabase/functions/send-email/index.ts",
];

export const detectModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) {
      return { ok: false as const, error: "LOVABLE_API_KEY not configured" };
    }

    // Pull prime config for grounding context
    const { data: prime } = await supabase
      .from("prime_config")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (!prime) {
      return { ok: false as const, error: "Configure prime repo first" };
    }

    // TODO: replace FALLBACK_TREE with real GitHub tree fetch via GitHub App.
    const tree = FALLBACK_TREE;

    const systemPrompt = `You are a senior software architect specializing in modular monorepo decomposition.
Given a file tree of a TanStack Start + Supabase project, identify cohesive MODULES — slices that can be independently injected into clone codebases.

A module is:
- A bounded feature (auth, billing, marketing, dashboard, blog, admin, etc.)
- Defined by file_globs (paths or glob patterns) and routes (URL paths)
- Has a clear single responsibility
- Should have 3-12 modules total — not too granular, not too broad

Return ONLY via the propose_modules tool call. No prose.`;

    const userPrompt = `Prime repo: ${prime.github_owner}/${prime.github_repo} (branch: ${prime.default_branch})

File tree (${tree.length} files):
${tree.map((f) => `- ${f}`).join("\n")}

Propose 3-8 modules. Each module's ai_confidence is 0..1 reflecting how cleanly it separates from the rest.`;

    const body = {
      model: "google/gemini-3-flash-preview",
      reasoning: { effort: "high" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "propose_modules",
            description: "Return a list of proposed modules.",
            parameters: {
              type: "object",
              properties: {
                modules: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      slug: {
                        type: "string",
                        description: "kebab-case unique identifier",
                      },
                      description: { type: "string" },
                      file_globs: { type: "array", items: { type: "string" } },
                      routes: { type: "array", items: { type: "string" } },
                      ai_confidence: { type: "number", minimum: 0, maximum: 1 },
                    },
                    required: [
                      "name",
                      "slug",
                      "description",
                      "file_globs",
                      "routes",
                      "ai_confidence",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ["modules"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "propose_modules" },
      },
    };

    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const t = await res.text();
      console.error("AI gateway error:", res.status, t);
      if (res.status === 429)
        return { ok: false as const, error: "Rate limited — try again shortly." };
      if (res.status === 402)
        return {
          ok: false as const,
          error: "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
        };
      return { ok: false as const, error: `AI error ${res.status}` };
    }

    const json = await res.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return { ok: false as const, error: "Model returned no tool call" };
    }

    let parsed: { modules: Proposed[] };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      return { ok: false as const, error: "Failed to parse model output" };
    }

    const modules = parsed.modules ?? [];
    if (modules.length === 0)
      return { ok: false as const, error: "Model proposed no modules" };

    // Upsert as proposed (don't clobber approved/archived)
    let inserted = 0;
    for (const m of modules) {
      const { data: existing } = await supabase
        .from("modules")
        .select("id, status")
        .eq("slug", m.slug)
        .maybeSingle();
      if (existing) continue;
      const { error } = await supabase.from("modules").insert({
        name: m.name,
        slug: m.slug,
        description: m.description,
        file_globs: m.file_globs,
        routes: m.routes,
        ai_confidence: m.ai_confidence,
        status: "proposed",
        detected_by_ai: true,
      });
      if (!error) inserted++;
    }

    return {
      ok: true as const,
      proposed: modules.length,
      inserted,
    };
  });
