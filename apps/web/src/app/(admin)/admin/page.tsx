import { prisma } from "@mastershopee/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function AdminOverviewPage() {
  const [userCount, workspaceCount, subscriptions, syncErrors, webhookErrors, unconfiguredCosts] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.subscription.findMany({ include: { plan: true, workspace: true } }),
    prisma.integrationSync.count({ where: { status: "FAILED" } }),
    prisma.webhookEvent.count({ where: { processingError: { not: null } } }),
    prisma.workspace.findMany({
      where: { products: { some: { costs: { none: {} } } } },
      select: { id: true, name: true },
      take: 10,
    }),
  ]);

  const active = subscriptions.filter((s) => s.status === "active");
  const trialing = subscriptions.filter((s) => s.status === "trialing");
  const canceled = subscriptions.filter((s) => s.status === "canceled" || s.status === "expired");
  const pastDue = subscriptions.filter((s) => s.status === "past_due");

  const mrr = active.reduce((sum, s) => sum + (s.interval === "yearly" ? Number(s.plan.priceYearly) / 12 : Number(s.plan.priceMonthly)), 0);
  const arr = mrr * 12;
  const churnRate = subscriptions.length === 0 ? 0 : (canceled.length / subscriptions.length) * 100;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Usuários", value: userCount.toString() },
          { label: "Empresas", value: workspaceCount.toString() },
          { label: "MRR", value: formatCurrency(mrr) },
          { label: "ARR", value: formatCurrency(arr) },
          { label: "Em trial", value: trialing.length.toString() },
          { label: "Pagamento pendente", value: pastDue.length.toString() },
          { label: "Churn", value: `${churnRate.toFixed(1)}%` },
          { label: "Assinaturas ativas", value: active.length.toString() },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-xl font-semibold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Saúde de integrações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sincronizações com erro</span>
              <Badge variant={syncErrors > 0 ? "destructive" : "success"}>{syncErrors}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Webhooks com erro de processamento</span>
              <Badge variant={webhookErrors > 0 ? "destructive" : "success"}>{webhookErrors}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clientes sem custo cadastrado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {unconfiguredCosts.length === 0 && <p className="text-muted-foreground">Todos os clientes com produtos têm custos cadastrados.</p>}
            {unconfiguredCosts.map((w) => (
              <p key={w.id}>{w.name}</p>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assinaturas</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Próxima cobrança</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.workspace.name}</TableCell>
                <TableCell>{s.plan.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{s.status}</Badge>
                </TableCell>
                <TableCell>{s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
