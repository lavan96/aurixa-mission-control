// Shared formatting helpers for the billing dashboard tabs.

export function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

export function money(cents: number, ccy = "USD"): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(cents / 100);
}
