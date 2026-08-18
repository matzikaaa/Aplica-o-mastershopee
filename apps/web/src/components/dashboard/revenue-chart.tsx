"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Point {
  date: string;
  grossRevenue: number;
  netProfit: number;
  expenses: number;
  adSpend: number;
}

const METRICS = [
  { key: "grossRevenue", label: "Faturamento", color: "hsl(var(--primary))" },
  { key: "netProfit", label: "Lucro líquido", color: "hsl(var(--success))" },
  { key: "expenses", label: "Despesas", color: "hsl(var(--destructive))" },
  { key: "adSpend", label: "ADS", color: "hsl(var(--warning))" },
] as const;

/** §12 — main chart with metric toggle (faturamento/lucro/despesas/ADS). */
export function RevenueChart({ data }: { data: Point[] }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("grossRevenue");
  const active = METRICS.find((m) => m.key === metric)!;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Evolução</CardTitle>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                metric === m.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="h-72 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={active.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={active.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDate(d)}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => formatCurrency(v)}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              width={80}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              labelFormatter={(d) => formatDate(d as string)}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area type="monotone" dataKey={metric} stroke={active.color} strokeWidth={2} fill="url(#chartFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
