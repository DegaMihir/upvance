"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const VIOLET = "#7C3AED";
const BLUE = "#2563EB";
const PALETTE = ["#7C3AED", "#2563EB", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#94A3B8"];

const axis = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { contentStyle: { background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 } };

export function ApplicationsChart({ data }: { data: { week: string; submitted: number; responses: number }[] }) {
  return (
    <div className="h-64 text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="week" {...axis} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="submitted" name="Submitted" fill={VIOLET} radius={[4, 4, 0, 0]} />
          <Bar dataKey="responses" name="Got a response" fill={BLUE} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RateLineChart({ data, dataKey = "rate", name = "Response rate %" }: { data: Record<string, string | number>[]; dataKey?: string; name?: string }) {
  return (
    <div className="h-64 text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis domain={[0, 100]} unit="%" {...axis} />
          <Tooltip {...tooltipStyle} />
          <Line type="monotone" dataKey={dataKey} name={name} stroke={VIOLET} strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBarChart({ data, unit = "" }: { data: { label: string; value: number }[]; unit?: string }) {
  return (
    <div className="text-muted-foreground" style={{ height: Math.max(120, data.length * 34 + 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
          <XAxis type="number" {...axis} unit={unit} />
          <YAxis type="category" dataKey="label" width={130} {...axis} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
          <Bar dataKey="value" fill={VIOLET} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <div className="h-56 text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="var(--color-card)">
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
