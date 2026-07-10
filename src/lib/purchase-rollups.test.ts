import { describe, it, expect } from "vitest";
import {
  aggregatePurchases,
  formatMoneyByCurrency,
  type PurchaseRollupRow,
} from "./purchase-rollups";

function row(overrides: Partial<PurchaseRollupRow> = {}): PurchaseRollupRow {
  return {
    amount_cents: 1000,
    currency: "AUD",
    mode: "topup",
    status: "completed",
    clone_id: "clone-1",
    clone_name: "NPC",
    origin_source: "clone:npc",
    origin_user_id: "user-1",
    origin_username: "Jess",
    ...overrides,
  };
}

describe("aggregatePurchases", () => {
  it("counts only completed rows as revenue", () => {
    const r = aggregatePurchases([
      row(),
      row({ status: "initiated", amount_cents: 99_999 }),
      row({ status: "failed", amount_cents: 99_999 }),
      row({ status: "refunded", amount_cents: 99_999 }),
      row({ status: "abandoned", amount_cents: 99_999 }),
    ]);
    expect(r.completedCount).toBe(1);
    expect(r.revenueByCurrency).toEqual({ AUD: 1000 });
  });

  it("never sums across currencies", () => {
    const r = aggregatePurchases([
      row({ amount_cents: 1000, currency: "AUD" }),
      row({ amount_cents: 500, currency: "usd" }),
    ]);
    expect(r.revenueByCurrency).toEqual({ AUD: 1000, USD: 500 });
  });

  it("computes the clone-initiated share (non-mission_control sources)", () => {
    const r = aggregatePurchases([
      row({ origin_source: "clone:npc" }),
      row({ origin_source: "mission_control" }),
      row({ origin_source: "prime:ref" }),
      row({ origin_source: "mission_control" }),
    ]);
    expect(r.attributedCount).toBe(2);
    expect(r.attributedShare).toBe(0.5);
  });

  it("groups by clone with Prime (null clone) as its own bucket, sorted by revenue", () => {
    const r = aggregatePurchases([
      row({ clone_id: "c1", clone_name: "Alpha", amount_cents: 100 }),
      row({ clone_id: "c2", clone_name: "Beta", amount_cents: 5000 }),
      row({ clone_id: null, clone_name: null, amount_cents: 300 }),
      row({ clone_id: "c2", clone_name: "Beta", amount_cents: 100 }),
    ]);
    expect(r.byClone.map((c) => c.cloneId)).toEqual(["c2", null, "c1"]);
    expect(r.byClone[0]).toMatchObject({ cloneName: "Beta", count: 2, revenue: { AUD: 5100 } });
  });

  it("groups users by (source, user id) so ids from different clones never merge", () => {
    const r = aggregatePurchases([
      row({ origin_source: "clone:a", origin_user_id: "u1" }),
      row({ origin_source: "clone:b", origin_user_id: "u1" }),
      row({ origin_source: "clone:a", origin_user_id: "u1", amount_cents: 200 }),
    ]);
    expect(r.byUser).toHaveLength(2);
    expect(r.byUser[0]).toMatchObject({ originUserId: "u1", count: 2 });
  });

  it("handles the empty ledger", () => {
    const r = aggregatePurchases([]);
    expect(r.completedCount).toBe(0);
    expect(r.attributedShare).toBe(0);
    expect(r.byClone).toEqual([]);
    expect(r.revenueByCurrency).toEqual({});
  });

  it("ignores null amounts without dropping the row from counts", () => {
    const r = aggregatePurchases([row({ amount_cents: null })]);
    expect(r.completedCount).toBe(1);
    expect(r.revenueByCurrency).toEqual({});
  });
});

describe("formatMoneyByCurrency", () => {
  it("renders per-currency amounts and an em dash for empty", () => {
    expect(formatMoneyByCurrency({})).toBe("—");
    expect(formatMoneyByCurrency({ AUD: 123400 })).toContain("1,234");
    const multi = formatMoneyByCurrency({ USD: 5000, AUD: 1000 });
    expect(multi).toContain(" + ");
    expect(multi.indexOf("AUD") === -1 || multi.indexOf("$") !== -1).toBe(true);
  });
});
