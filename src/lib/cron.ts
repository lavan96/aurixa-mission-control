// Tiny cron parser & next-tick computer. Supports standard 5-field cron:
//   minute  hour  day-of-month  month  day-of-week
// Each field may be: *, n, n-m, n,m, */n
// No seconds. UTC. Designed to be deterministic and Worker-safe.

type Field = number[];

function parseField(spec: string, min: number, max: number): Field {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      step = Math.max(1, parseInt(part.slice(slash + 1), 10) || 1);
      range = part.slice(0, slash);
    }
    let lo = min;
    let hi = max;
    if (range !== "*" && range !== "") {
      if (range.includes("-")) {
        const [a, b] = range.split("-");
        lo = parseInt(a, 10);
        hi = parseInt(b, 10);
      } else {
        const n = parseInt(range, 10);
        if (!Number.isNaN(n)) {
          lo = n;
          hi = n;
        }
      }
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = Math.max(lo, min); v <= Math.min(hi, max); v += step) {
      out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export type ParsedCron = {
  minutes: Field;
  hours: Field;
  doms: Field;
  months: Field;
  dows: Field;
};

export function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    return {
      minutes: parseField(parts[0], 0, 59),
      hours: parseField(parts[1], 0, 23),
      doms: parseField(parts[2], 1, 31),
      months: parseField(parts[3], 1, 12),
      dows: parseField(parts[4], 0, 6),
    };
  } catch {
    return null;
  }
}

// Find the next UTC date strictly after `from` matching the cron expression.
// Searches up to 4 years to keep it bounded.
export function nextCronTick(expr: string, from: Date = new Date()): Date | null {
  const p = parseCron(expr);
  if (!p) return null;
  if (p.minutes.length === 0 || p.hours.length === 0 || p.months.length === 0) return null;

  const start = new Date(from.getTime() + 60_000 - (from.getTime() % 60_000));
  const limit = new Date(start.getTime() + 4 * 365 * 24 * 60 * 60 * 1000);
  const cur = new Date(start);

  while (cur < limit) {
    const month = cur.getUTCMonth() + 1;
    if (!p.months.includes(month)) {
      cur.setUTCMonth(cur.getUTCMonth() + 1, 1);
      cur.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const dom = cur.getUTCDate();
    const dow = cur.getUTCDay();
    if (!p.doms.includes(dom) || !p.dows.includes(dow)) {
      cur.setUTCDate(dom + 1);
      cur.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const hour = cur.getUTCHours();
    if (!p.hours.includes(hour)) {
      cur.setUTCHours(hour + 1, 0, 0, 0);
      continue;
    }
    const minute = cur.getUTCMinutes();
    if (!p.minutes.includes(minute)) {
      cur.setUTCMinutes(minute + 1, 0, 0);
      continue;
    }
    return new Date(cur);
  }
  return null;
}

export function describeCron(expr: string): string {
  const p = parseCron(expr);
  if (!p) return expr;
  const parts = expr.trim().split(/\s+/);
  // Recognize a few common patterns for friendlier text
  if (
    parts[0] === "0" &&
    parts[1] === "*" &&
    parts[2] === "*" &&
    parts[3] === "*" &&
    parts[4] === "*"
  )
    return "Every hour";
  if (
    parts[0].startsWith("*/") &&
    parts[1] === "*" &&
    parts[2] === "*" &&
    parts[3] === "*" &&
    parts[4] === "*"
  )
    return `Every ${parts[0].slice(2)} minutes`;
  if (
    parts[1].startsWith("*/") &&
    parts[0] === "0" &&
    parts[2] === "*" &&
    parts[3] === "*" &&
    parts[4] === "*"
  )
    return `Every ${parts[1].slice(2)} hours`;
  if (
    parts[0] === "0" &&
    parts[1] === "0" &&
    parts[2] === "*" &&
    parts[3] === "*" &&
    parts[4] === "*"
  )
    return "Daily at 00:00 UTC";
  if (
    parts[2] === "*" &&
    parts[3] === "*" &&
    parts[4] !== "*" &&
    /^\d+$/.test(parts[0]) &&
    /^\d+$/.test(parts[1])
  ) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dows = parts[4]
      .split(",")
      .map((d) => days[parseInt(d, 10)] ?? d)
      .join("/");
    return `Weekly on ${dows} at ${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")} UTC`;
  }
  return expr;
}
