"use client";

import { ArrowDownRight, ArrowUpRight, HelpCircle, Minus } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip as InfoTooltip } from "@/components/ui/tooltip";
import { cn, formatPercent } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string;
  changePercent?: number | null;
  tooltip?: string;
  sparkline?: number[];
  tone?: "neutral" | "success" | "destructive";
}

/** §9: value + comparação com período anterior + micro gráfico + tooltip. */
export function MetricCard({ label, value, changePercent, tooltip, sparkline, tone = "neutral" }: MetricCardProps) {
  const isPositive = (changePercent ?? 0) > 0;
  const isNegative = (changePercent ?? 0) < 0;
  const toneClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";

  return (
    <Card className="animate-slide-up">
      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {tooltip && (
            <InfoTooltip label={tooltip}>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
            </InfoTooltip>
          )}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={cn("text-2xl font-semibold tracking-tight", toneClass)}>{value}</p>
            {changePercent !== undefined && changePercent !== null && (
              <div
                className={cn(
                  "mt-1 flex items-center gap-0.5 text-xs font-medium",
                  isPositive && "text-success",
                  isNegative && "text-destructive",
                  !isPositive && !isNegative && "text-muted-foreground",
                )}
              >
                {isPositive && <ArrowUpRight className="h-3 w-3" />}
                {isNegative && <ArrowDownRight className="h-3 w-3" />}
                {!isPositive && !isNegative && <Minus className="h-3 w-3" />}
                {formatPercent(changePercent)}
                <span className="font-normal text-muted-foreground">vs período anterior</span>
              </div>
            )}
          </div>
          {sparkline && sparkline.length > 1 && (
            <div className="h-10 w-20">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparkline.map((v, i) => ({ i, v }))}>
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke={isNegative ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
