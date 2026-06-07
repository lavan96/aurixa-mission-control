import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

type Series = { date: string; applied: number; pending: number; drifted: number; failed: number };

export default function SloDriftChart({ series }: { series: Series[] }) {
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer>
        <BarChart data={series}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="applied" stackId="a" fill="hsl(var(--success))" />
          <Bar dataKey="pending" stackId="a" fill="hsl(var(--info))" />
          <Bar dataKey="drifted" stackId="a" fill="hsl(var(--warning))" />
          <Bar dataKey="failed" stackId="a" fill="hsl(var(--destructive))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
