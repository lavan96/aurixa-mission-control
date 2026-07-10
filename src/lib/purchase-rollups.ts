/**
 * Pure aggregation for the purchases attribution ledger
 * (user-attributed pricing workflow, Phase 4). Client-safe: no imports.
 *
 * Amounts are aggregated per currency — never summed across currencies.
 */

export type PurchaseRollupRow = {
  amount_cents: number | null;
  currency: string | null;
  mode: string;
  status: string;
  clone_id: string | null;
  clone_name?: string | null;
  origin_source: string;
  origin_user_id: string | null;
  origin_username: string | null;
};

export type MoneyByCurrency = Record<string, number>;

export type PurchaseRollups = {
  completedCount: number;
  revenueByCurrency: MoneyByCurrency;
  /** completed purchases initiated outside Mission Control (handoff traffic). */
  attributedCount: number;
  attributedShare: number; // 0..1 of completed purchases
  byMode: { mode: string; count: number; revenue: MoneyByCurrency }[];
  bySource: { source: string; count: number; revenue: MoneyByCurrency }[];
  byClone: {
    cloneId: string | null;
    cloneName: string | null;
    count: number;
    revenue: MoneyByCurrency;
  }[];
  byUser: {
    originUserId: string | null;
    originUsername: string | null;
    count: number;
    revenue: MoneyByCurrency;
  }[];
};

function addMoney(target: MoneyByCurrency, amountCents: number | null, currency: string | null) {
  if (amountCents == null || amountCents === 0) return;
  const ccy = (currency ?? "AUD").toUpperCase();
  target[ccy] = (target[ccy] ?? 0) + amountCents;
}

/** Formats a per-currency map like "A$1,234.00 + $99.00" (compact, stable order). */
export function formatMoneyByCurrency(money: MoneyByCurrency): string {
  const entries = Object.entries(money).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "—";
  return entries
    .map(([ccy, cents]) => {
      try {
        return new Intl.NumberFormat("en-AU", { style: "currency", currency: ccy }).format(
          cents / 100,
        );
      } catch {
        return `${(cents / 100).toFixed(2)} ${ccy}`;
      }
    })
    .join(" + ");
}

/**
 * Aggregates COMPLETED purchases only — 'initiated'/'abandoned'/'failed' rows
 * never count as revenue, and refunded rows are excluded as reversed.
 */
export function aggregatePurchases(rows: PurchaseRollupRow[]): PurchaseRollups {
  const completed = rows.filter((r) => r.status === "completed");

  const revenueByCurrency: MoneyByCurrency = {};
  let attributedCount = 0;

  const byModeMap = new Map<string, { count: number; revenue: MoneyByCurrency }>();
  const bySourceMap = new Map<string, { count: number; revenue: MoneyByCurrency }>();
  const byCloneMap = new Map<
    string,
    { cloneId: string | null; cloneName: string | null; count: number; revenue: MoneyByCurrency }
  >();
  const byUserMap = new Map<
    string,
    {
      originUserId: string | null;
      originUsername: string | null;
      count: number;
      revenue: MoneyByCurrency;
    }
  >();

  for (const row of completed) {
    addMoney(revenueByCurrency, row.amount_cents, row.currency);
    if (row.origin_source !== "mission_control") attributedCount += 1;

    const mode = byModeMap.get(row.mode) ?? { count: 0, revenue: {} };
    mode.count += 1;
    addMoney(mode.revenue, row.amount_cents, row.currency);
    byModeMap.set(row.mode, mode);

    const source = bySourceMap.get(row.origin_source) ?? { count: 0, revenue: {} };
    source.count += 1;
    addMoney(source.revenue, row.amount_cents, row.currency);
    bySourceMap.set(row.origin_source, source);

    const cloneKey = row.clone_id ?? "__prime__";
    const clone = byCloneMap.get(cloneKey) ?? {
      cloneId: row.clone_id,
      cloneName: row.clone_name ?? null,
      count: 0,
      revenue: {},
    };
    clone.count += 1;
    clone.cloneName = clone.cloneName ?? row.clone_name ?? null;
    addMoney(clone.revenue, row.amount_cents, row.currency);
    byCloneMap.set(cloneKey, clone);

    const userKey = `${row.origin_source}|${row.origin_user_id ?? "unknown"}`;
    const user = byUserMap.get(userKey) ?? {
      originUserId: row.origin_user_id,
      originUsername: row.origin_username,
      count: 0,
      revenue: {},
    };
    user.count += 1;
    user.originUsername = user.originUsername ?? row.origin_username;
    addMoney(user.revenue, row.amount_cents, row.currency);
    byUserMap.set(userKey, user);
  }

  const totalRevenue = (m: MoneyByCurrency) => Object.values(m).reduce((a, b) => a + b, 0);
  const byRevenueDesc = <T extends { revenue: MoneyByCurrency; count: number }>(a: T, b: T) =>
    totalRevenue(b.revenue) - totalRevenue(a.revenue) || b.count - a.count;

  return {
    completedCount: completed.length,
    revenueByCurrency,
    attributedCount,
    attributedShare: completed.length > 0 ? attributedCount / completed.length : 0,
    byMode: [...byModeMap.entries()].map(([mode, v]) => ({ mode, ...v })).sort(byRevenueDesc),
    bySource: [...bySourceMap.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort(byRevenueDesc),
    byClone: [...byCloneMap.values()].sort(byRevenueDesc),
    byUser: [...byUserMap.values()].sort(byRevenueDesc),
  };
}
