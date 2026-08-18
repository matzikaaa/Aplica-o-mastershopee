import { Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { resolveDateRange, previousPeriod, type DateRangePreset } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { generateInsights } from "@/lib/insights";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const TONE_STYLES = {
  positive: { icon: TrendingUp, className: "border-success/30 bg-success/5", iconClass: "text-success" },
  negative: { icon: TrendingDown, className: "border-destructive/30 bg-destructive/5", iconClass: "text-destructive" },
  neutral: { icon: Lightbulb, className: "border-border", iconClass: "text-muted-foreground" },
} as const;

export default async function InsightsPage({ searchParams }: { searchParams: { period?: string } }) {
  const { workspace } = await requireWorkspace();
  const period = (searchParams.period ?? "last_30_days") as DateRangePreset;
  const range = resolveDateRange(period, workspace.timezone);
  const previous = previousPeriod(range);

  const insights = await generateInsights(workspace.id, range, previous);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            Leituras automáticas sobre sua operação, sempre com os números que levaram a cada conclusão.
          </p>
        </div>
        <DateRangePicker current={period} />
      </div>

      {insights.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="Nada digno de destaque neste período"
          description="Assim que houver uma variação relevante de lucro, margem ou ADS, ela aparecerá aqui automaticamente."
        />
      ) : (
        <div className="space-y-4">
          {insights.map((insight) => {
            const tone = TONE_STYLES[insight.tone];
            const Icon = tone.icon;
            return (
              <Card key={insight.id} className={cn(tone.className)}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", tone.iconClass)} />
                    <div className="flex-1">
                      <p className="font-medium">{insight.headline}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                        {insight.evidence.map((e) => (
                          <div key={e.label}>
                            <dt className="text-xs text-muted-foreground">{e.label}</dt>
                            <dd className="text-sm font-medium">{e.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Insights gerados por regras determinísticas sobre os dados já sincronizados — nunca uma estimativa sem os números que a sustentam.
      </p>
    </div>
  );
}
