import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateAlertDialog } from "@/components/alerts/create-alert-dialog";
import { relativeTime } from "@/lib/utils";
import { Bell } from "lucide-react";

const SEVERITY_VARIANT = { CRITICAL: "destructive", IMPORTANT: "warning", INFORMATIVE: "default" } as const;
const SEVERITY_LABEL = { CRITICAL: "Críticos", IMPORTANT: "Importantes", INFORMATIVE: "Informativos" } as const;

export default async function AlertsPage() {
  const { workspace } = await requireWorkspace();

  const [rules, events] = await Promise.all([
    prisma.alertRule.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" } }),
    prisma.alertEvent.findMany({ where: { workspaceId: workspace.id }, orderBy: { triggeredAt: "desc" }, take: 30 }),
  ]);

  const grouped = (["CRITICAL", "IMPORTANT", "INFORMATIVE"] as const).map((sev) => ({
    severity: sev,
    events: events.filter((e) => e.severity === sev),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
          <p className="text-sm text-muted-foreground">{rules.length} regra(s) configurada(s).</p>
        </div>
        <CreateAlertDialog />
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nenhum alerta disparado ainda"
          description="Assim que uma regra configurada for atendida — como um produto com margem negativa — o alerta aparecerá aqui."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(
            (group) =>
              group.events.length > 0 && (
                <div key={group.severity}>
                  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{SEVERITY_LABEL[group.severity]}</h2>
                  <div className="space-y-2">
                    {group.events.map((event) => (
                      <Card key={event.id}>
                        <CardContent className="flex items-center justify-between p-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant={SEVERITY_VARIANT[group.severity]}>{SEVERITY_LABEL[group.severity]}</Badge>
                              <span className="font-medium">{event.title}</span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(event.triggeredAt)}</span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Regras configuradas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma regra criada ainda.</p>}
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
              <span>{rule.type}</span>
              <Badge variant={rule.isActive ? "success" : "default"}>{rule.isActive ? "Ativa" : "Inativa"}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
