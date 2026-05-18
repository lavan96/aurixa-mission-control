import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Plans ───────────────────────────────────────────────────────────────────

export const listPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("billing_plans")
      .select("*")
      .order("price_cents", { ascending: true });
    if (error) throw new Error(error.message);
    return { plans: data ?? [] };
  });

export const upsertPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
        name: z.string().min(1).max(120),
        monthly_allowance: z.number().int().min(0),
        rollover_cap: z.number().int().min(0).default(0),
        overage_policy: z.enum(["block", "topup_only", "pay_as_you_go"]),
        price_cents: z.number().int().min(0),
        currency: z.string().length(3).default("USD"),
        is_active: z.boolean().default(true),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (id) {
      const { error } = await context.supabase
        .from("billing_plans")
        .update(rest)
        .eq("id", id);
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { error } = await context.supabase.from("billing_plans").insert(rest);
      if (error) return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

// ─── Top-up Packs ────────────────────────────────────────────────────────────

export const listPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("topup_packs")
      .select("*")
      .order("tokens", { ascending: true });
    if (error) throw new Error(error.message);
    return { packs: data ?? [] };
  });

export const upsertPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
        name: z.string().min(1).max(120),
        tokens: z.number().int().positive(),
        price_cents: z.number().int().min(0),
        currency: z.string().length(3).default("USD"),
        expires_after_days: z.number().int().positive().nullable().optional(),
        is_active: z.boolean().default(true),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (id) {
      const { error } = await context.supabase
        .from("topup_packs")
        .update(rest)
        .eq("id", id);
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { error } = await context.supabase.from("topup_packs").insert(rest);
      if (error) return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

// ─── Rates ───────────────────────────────────────────────────────────────────

export const listRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("token_rates")
      .select("*")
      .order("kind", { ascending: true })
      .order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return { rates: data ?? [] };
  });

export const upsertRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        kind: z.string().min(1).max(64),
        base_cost: z.number().int().min(0),
        per_unit: z.record(z.string(), z.number()).default({}),
        notes: z.string().max(500).nullable().optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    if (id) {
      const { error } = await context.supabase
        .from("token_rates")
        .update(rest)
        .eq("id", id);
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { error } = await context.supabase.from("token_rates").insert(rest);
      if (error) return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const listTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        cloneId: z.string().uuid().optional(),
        search: z.string().max(200).optional(),
        status: z.enum(["active", "past_due", "canceled"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {})
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("tenants")
      .select(
        `id, clone_id, external_ref, display_name, status, current_period_end,
         plan_id, plan_started_at,
         billing_plans:plan_id(slug, name, monthly_allowance),
         token_balances(available, reserved, lifetime_spent)`
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.cloneId) q = q.eq("clone_id", data.cloneId);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) {
      q = q.or(
        `display_name.ilike.%${data.search}%,external_ref.ilike.%${data.search}%`
      );
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { tenants: rows ?? [] };
  });

export const getTenant = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [tenantRes, balanceRes, ledgerRes, jobsRes] = await Promise.all([
      supabase
        .from("tenants")
        .select(
          `*, billing_plans:plan_id(*), clones:clone_id(id, name, slug)`
        )
        .eq("id", data.id)
        .maybeSingle(),
      supabase
        .from("token_balances")
        .select("*")
        .eq("tenant_id", data.id)
        .maybeSingle(),
      supabase
        .from("token_ledger")
        .select("*")
        .eq("tenant_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("report_jobs")
        .select("*")
        .eq("tenant_id", data.id)
        .order("started_at", { ascending: false })
        .limit(50),
    ]);
    if (tenantRes.error) throw new Error(tenantRes.error.message);
    return {
      tenant: tenantRes.data,
      balance: balanceRes.data,
      ledger: ledgerRes.data ?? [],
      jobs: jobsRes.data ?? [],
    };
  });

export const assignTenantPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        tenantId: z.string().uuid(),
        planId: z.string().uuid(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const { error } = await context.supabase
      .from("tenants")
      .update({
        plan_id: data.planId,
        plan_started_at: now.toISOString(),
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        status: "active",
      })
      .eq("id", data.tenantId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const grantTenantTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        tenantId: z.string().uuid(),
        tokens: z.number().int().positive().max(10_000_000),
        reason: z.string().min(1).max(300),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("grant_tokens", {
      _tenant_id: data.tenantId,
      _tokens: data.tokens,
      _reason: data.reason,
      _expires_at: data.expiresAt ?? undefined,
    });
    if (error) return { ok: false as const, error: error.message };
    return result as { ok: boolean; error?: string };
  });

export const applyTenantTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        tenantId: z.string().uuid(),
        packId: z.string().uuid(),
        sourceRef: z.string().max(200).nullable().optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("apply_topup", {
      _tenant_id: data.tenantId,
      _pack_id: data.packId,
      _source_ref: data.sourceRef ?? undefined,
    });
    if (error) return { ok: false as const, error: error.message };
    return result as { ok: boolean; error?: string; tokens?: number };
  });

export const refundReportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        jobId: z.string().uuid(),
        reason: z.string().min(1).max(300),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("refund_job", {
      _job_id: data.jobId,
      _reason: data.reason,
    });
    if (error) return { ok: false as const, error: error.message };
    return result as { ok: boolean; error?: string; refunded_tokens?: number };
  });

// ─── Fleet usage summary ─────────────────────────────────────────────────────

export const getTokenUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const [tenantsRes, jobsRes, balancesRes] = await Promise.all([
      context.supabase
        .from("tenants")
        .select("id, status", { count: "exact" }),
      context.supabase
        .from("report_jobs")
        .select("kind, charged_tokens, started_at, status")
        .gte("started_at", since.toISOString())
        .eq("status", "completed")
        .limit(5000),
      context.supabase
        .from("token_balances")
        .select("available, lifetime_granted, lifetime_spent"),
    ]);
    const jobs = jobsRes.data ?? [];
    const balances = balancesRes.data ?? [];
    const totalSpent30d = jobs.reduce((s, j) => s + (j.charged_tokens ?? 0), 0);
    const totalAvailable = balances.reduce((s, b) => s + (b.available ?? 0), 0);
    const totalGranted = balances.reduce(
      (s, b) => s + (b.lifetime_granted ?? 0),
      0
    );
    // Group by kind
    const byKind = new Map<string, number>();
    for (const j of jobs) {
      byKind.set(j.kind, (byKind.get(j.kind) ?? 0) + (j.charged_tokens ?? 0));
    }
    const topKinds = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([kind, tokens]) => ({ kind, tokens }));
    // Day buckets
    const byDay = new Map<string, number>();
    for (const j of jobs) {
      const day = (j.started_at ?? "").slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + (j.charged_tokens ?? 0));
    }
    const series = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, tokens]) => ({ day, tokens }));
    return {
      totalTenants: tenantsRes.count ?? 0,
      totalSpent30d,
      totalAvailable,
      totalGranted,
      jobCount30d: jobs.length,
      topKinds,
      series,
    };
  });

// ─── Report jobs (admin listing) ─────────────────────────────────────────────

export const listReportJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        tenantId: z.string().uuid().optional(),
        cloneId: z.string().uuid().optional(),
        status: z
          .enum(["reserved", "completed", "canceled", "refunded", "expired"])
          .optional(),
        kind: z.string().max(120).optional(),
        search: z.string().max(200).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {})
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("report_jobs")
      .select(
        `id, tenant_id, clone_id, kind, status,
         estimated_tokens, charged_tokens,
         idempotency_key, error, started_at, completed_at, reservation_expires_at,
         tenants:tenant_id(display_name, external_ref),
         clones:clone_id(name, slug)`,
        { count: "exact" }
      )
      .order("started_at", { ascending: false })
      .limit(data.limit);
    if (data.tenantId) q = q.eq("tenant_id", data.tenantId);
    if (data.cloneId) q = q.eq("clone_id", data.cloneId);
    if (data.status) q = q.eq("status", data.status);
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.from) q = q.gte("started_at", data.from);
    if (data.to) q = q.lte("started_at", data.to);
    if (data.search) {
      q = q.or(
        `idempotency_key.ilike.%${data.search}%,kind.ilike.%${data.search}%`
      );
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    // Aggregate totals across the filtered set (separate query — capped at 5000 for safety)
    let aggQ = context.supabase
      .from("report_jobs")
      .select("status, estimated_tokens, charged_tokens")
      .limit(5000);
    if (data.tenantId) aggQ = aggQ.eq("tenant_id", data.tenantId);
    if (data.cloneId) aggQ = aggQ.eq("clone_id", data.cloneId);
    if (data.status) aggQ = aggQ.eq("status", data.status);
    if (data.kind) aggQ = aggQ.eq("kind", data.kind);
    if (data.from) aggQ = aggQ.gte("started_at", data.from);
    if (data.to) aggQ = aggQ.lte("started_at", data.to);
    const { data: aggRows } = await aggQ;

    const totals = {
      reserved: 0,
      committed: 0,
      canceled: 0,
      refunded: 0,
      jobs: aggRows?.length ?? 0,
    };
    for (const r of aggRows ?? []) {
      if (r.status === "reserved") totals.reserved += r.estimated_tokens ?? 0;
      else if (r.status === "completed") totals.committed += r.charged_tokens ?? 0;
      else if (r.status === "canceled" || r.status === "expired")
        totals.canceled += r.estimated_tokens ?? 0;
      else if (r.status === "refunded") totals.refunded += r.charged_tokens ?? 0;
    }

    return { jobs: rows ?? [], count: count ?? 0, totals };
  });
