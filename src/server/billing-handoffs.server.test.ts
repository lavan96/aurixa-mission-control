import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  insertResult: {
    data: null as Record<string, unknown> | null,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const b: Record<string, unknown> = {
      insert: (values: Record<string, unknown>) => {
        state.inserted = values;
        return b;
      },
      select: () => b,
      single: async () => state.insertResult,
    };
    return b;
  };
  return { supabaseAdmin: { from: () => builder() } };
});

import { afterEach } from "vitest";
import {
  HANDOFF_TTL_MINUTES,
  createHandoff,
  handoffUrl,
  intentAllows,
  intentItemId,
  intentMode,
  storefrontPricingBase,
  validateReturnUrl,
} from "./billing-handoffs.server";
import { DEFAULT_STOREFRONT_PRICING_URL } from "@/lib/storefront";

beforeEach(() => {
  state.inserted = null;
  state.insertResult = { data: null, error: null };
});

describe("intentMode / handoffLandingPath / handoffUrl", () => {
  it("parses the mode prefix out of an intent", () => {
    expect(intentMode("topup:1234")).toBe("topup");
    expect(intentMode("seat_plan")).toBe("seat_plan");
    expect(intentMode("")).toBeNull();
    expect(intentMode(null)).toBeNull();
    expect(intentMode(undefined)).toBeNull();
  });

  it("parses the item id out of an intent", () => {
    expect(intentItemId("topup:1234")).toBe("1234");
    expect(intentItemId("topup")).toBeNull();
    expect(intentItemId(null)).toBeNull();
  });

  it("builds the deep link off the pricing base, trimming trailing slashes", () => {
    expect(handoffUrl("https://aurixasystems.example.com/pricing/", "abc")).toBe(
      "https://aurixasystems.example.com/pricing?h=abc",
    );
    expect(handoffUrl("https://mc.example.com/pricing", "abc")).toBe(
      "https://mc.example.com/pricing?h=abc",
    );
  });
});

describe("storefrontPricingBase", () => {
  afterEach(() => {
    delete process.env.PUBLIC_PRICING_SITE_URL;
  });

  it("prefers the configured Aurixa Systems storefront URL", () => {
    process.env.PUBLIC_PRICING_SITE_URL = "https://aurixasystems.example.com/pricing/";
    expect(storefrontPricingBase()).toBe("https://aurixasystems.example.com/pricing");
  });

  it("falls back to the default storefront URL when unset or malformed", () => {
    expect(storefrontPricingBase()).toBe(DEFAULT_STOREFRONT_PRICING_URL);
    process.env.PUBLIC_PRICING_SITE_URL = "not-a-url";
    expect(storefrontPricingBase()).toBe(DEFAULT_STOREFRONT_PRICING_URL);
  });
});

describe("intentAllows (handoff-scoped checkout restriction)", () => {
  it("allows the whole catalog when the handoff has no intent", () => {
    expect(intentAllows(null, "topup", "item-1")).toBe(true);
    expect(intentAllows("", "seat_plan", "item-2")).toBe(true);
  });

  it("pins the mode for bare-mode intents", () => {
    expect(intentAllows("topup", "topup", "any-pack")).toBe(true);
    expect(intentAllows("topup", "seat_plan", "any-plan")).toBe(false);
  });

  it("pins the exact item for '<mode>:<item>' intents", () => {
    expect(intentAllows("topup:item-1", "topup", "item-1")).toBe(true);
    expect(intentAllows("topup:item-1", "topup", "item-2")).toBe(false);
    expect(intentAllows("topup:item-1", "setup_package", "item-1")).toBe(false);
  });
});

describe("validateReturnUrl (open-redirect guard)", () => {
  it("accepts absent return URLs", () => {
    expect(validateReturnUrl(null, null)).toEqual({ ok: true, url: null });
    expect(validateReturnUrl(undefined, "https://clone.example.com")).toEqual({
      ok: true,
      url: null,
    });
  });

  it("rejects non-https and unparseable URLs", () => {
    expect(validateReturnUrl("http://clone.example.com/billing", null)).toEqual({
      ok: false,
      error: "return_url_not_https",
    });
    expect(validateReturnUrl("javascript:alert(1)", null)).toMatchObject({ ok: false });
    expect(validateReturnUrl("not a url", null)).toEqual({
      ok: false,
      error: "return_url_invalid",
    });
  });

  it("pins the host to the clone's deploy_url when present", () => {
    expect(
      validateReturnUrl("https://clone.example.com/settings", "https://clone.example.com"),
    ).toEqual({ ok: true, url: "https://clone.example.com/settings" });
    expect(validateReturnUrl("https://evil.example.net/", "https://clone.example.com")).toEqual({
      ok: false,
      error: "return_url_host_mismatch",
    });
  });

  it("accepts any https URL when the clone has no (or an unparseable) deploy_url", () => {
    expect(validateReturnUrl("https://anywhere.example.com/x", null)).toMatchObject({ ok: true });
    expect(validateReturnUrl("https://anywhere.example.com/x", "not a url")).toMatchObject({
      ok: true,
    });
  });
});

describe("createHandoff", () => {
  it("inserts the attribution row with a TTL and returns the id", async () => {
    state.insertResult = {
      data: { id: "h-1", expires_at: "2026-07-10T14:00:00Z" },
      error: null,
    };
    const before = Date.now();
    const res = await createHandoff({
      cloneId: "c-1",
      tenantId: "t-1",
      originUserId: "user-9",
      originUsername: "Jess",
      originSource: "clone:npc",
      intent: "topup",
      returnUrl: "https://clone.example.com/billing",
    });
    expect(res).toEqual({ ok: true, id: "h-1", expiresAt: "2026-07-10T14:00:00Z" });
    expect(state.inserted).toMatchObject({
      clone_id: "c-1",
      tenant_id: "t-1",
      origin_user_id: "user-9",
      origin_username: "Jess",
      origin_source: "clone:npc",
      intent: "topup",
      return_url: "https://clone.example.com/billing",
    });
    const expires = new Date(state.inserted!.expires_at as string).getTime();
    const expectedMs = HANDOFF_TTL_MINUTES * 60_000;
    expect(expires - before).toBeGreaterThan(expectedMs - 5_000);
    expect(expires - before).toBeLessThan(expectedMs + 5_000);
  });

  it("propagates insert failures", async () => {
    state.insertResult = { data: null, error: { message: "rls denied" } };
    const res = await createHandoff({
      cloneId: null,
      tenantId: null,
      originUserId: "user-9",
      originSource: "prime:ref",
    });
    expect(res).toEqual({ ok: false, error: "rls denied" });
  });
});
