import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";

// Controllable state for the mocked Supabase admin client. `row`/`error` are what
// the select(...).maybeSingle() chain resolves to.
const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      update: () => b,
      maybeSingle: async () => ({ data: state.row, error: state.error }),
    };
    return b;
  };
  return { supabaseAdmin: { from: () => builder() } };
});

import { hashApiKey, generateApiKey, resolveCloneApiKey } from "./clone-api-keys.server";

describe("hashApiKey", () => {
  it("is a deterministic sha256 hex digest", () => {
    expect(hashApiKey("hello")).toBe(createHash("sha256").update("hello").digest("hex"));
    expect(hashApiKey("hello")).toBe(hashApiKey("hello"));
    expect(hashApiKey("hello")).toHaveLength(64);
  });

  it("differs for different inputs", () => {
    expect(hashApiKey("a")).not.toBe(hashApiKey("b"));
  });
});

describe("generateApiKey", () => {
  it("produces an mck_-prefixed key whose hash and 12-char prefix match", () => {
    const { raw, hash, prefix } = generateApiKey();
    expect(raw.startsWith("mck_")).toBe(true);
    expect(prefix).toBe(raw.slice(0, 12));
    expect(prefix.startsWith("mck_")).toBe(true);
    expect(hash).toBe(hashApiKey(raw));
  });

  it("is unguessable / unique across calls", () => {
    expect(generateApiKey().raw).not.toBe(generateApiKey().raw);
  });
});

describe("resolveCloneApiKey", () => {
  beforeEach(() => {
    state.row = null;
    state.error = null;
  });

  it("rejects null/empty/malformed keys without a DB lookup", async () => {
    expect(await resolveCloneApiKey(null, "tokens:meter")).toBeNull();
    expect(await resolveCloneApiKey("", "tokens:meter")).toBeNull();
    expect(await resolveCloneApiKey("sk_not_ours", "tokens:meter")).toBeNull();
  });

  it("resolves a valid key carrying the required scope", async () => {
    state.row = {
      id: "key-1",
      clone_id: "clone-1",
      scopes: ["tokens:meter", "seats:read"],
      revoked_at: null,
      label: "prod",
      key_prefix: "mck_abc",
      first_used_at: null,
    };
    const resolved = await resolveCloneApiKey("mck_validkey", "tokens:meter");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe("key-1");
    expect(resolved!.clone_id).toBe("clone-1");
  });

  it("accepts any-of when multiple scopes are required", async () => {
    state.row = {
      id: "key-2",
      clone_id: "clone-1",
      scopes: ["seats:read"],
      revoked_at: null,
    };
    expect(await resolveCloneApiKey("mck_x", ["tokens:meter", "seats:read"])).not.toBeNull();
  });

  it("rejects a revoked key", async () => {
    state.row = {
      id: "key-3",
      clone_id: "clone-1",
      scopes: ["tokens:meter"],
      revoked_at: new Date().toISOString(),
    };
    expect(await resolveCloneApiKey("mck_x", "tokens:meter")).toBeNull();
  });

  it("rejects when the required scope is absent", async () => {
    state.row = {
      id: "key-4",
      clone_id: "clone-1",
      scopes: ["seats:read"],
      revoked_at: null,
    };
    expect(await resolveCloneApiKey("mck_x", "tokens:meter")).toBeNull();
  });

  it("returns null when the key is not found", async () => {
    state.row = null;
    expect(await resolveCloneApiKey("mck_missing", "tokens:meter")).toBeNull();
  });
});
