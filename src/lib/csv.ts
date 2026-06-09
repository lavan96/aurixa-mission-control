/**
 * Tiny CSV helpers — RFC4180-ish, BOM-prefixed for Excel.
 */

function escape(value: unknown): string {
  if (value == null) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCSV<T extends Record<string, unknown>>(
  rows: T[],
  columns?: { key: keyof T; header?: string }[],
): string {
  if (rows.length === 0) return "";
  const cols =
    columns ??
    (Object.keys(rows[0]).map((k) => ({ key: k as keyof T })) as {
      key: keyof T;
      header?: string;
    }[]);
  const header = cols.map((c) => escape(c.header ?? String(c.key))).join(",");
  const body = rows.map((row) => cols.map((c) => escape(row[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRowsAsCSV<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns?: { key: keyof T; header?: string }[],
) {
  downloadCSV(filename, toCSV(rows, columns));
}
