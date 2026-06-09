import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

type Point = { date: string; count: number };

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      No data yet
    </div>
  );
}

export function CascadesByDayChart({ data }: { data?: Point[] }) {
  if (!data?.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="count"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DriftByDayChart({ data }: { data?: Point[] }) {
  if (!data?.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="count"
          stroke="hsl(var(--warning))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AiByDayChart({ data }: { data?: Point[] }) {
  if (!data?.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="count"
          stroke="hsl(var(--accent))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default { CascadesByDayChart, DriftByDayChart, AiByDayChart };
