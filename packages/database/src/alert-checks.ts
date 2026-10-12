import type { AlertSeverity } from "@prisma/client";
import { chaveDoDia, dataDoDia, inicioDoDia, somarDias } from "@mastershopee/shared";
import { prisma } from "./index";

/**
 * Avalia toda regra de alerta ativa contra as métricas de ontem (§24-25) e
 * cria AlertEvent + Notification quando a condição acontece.
 *
 * Morava só no worker, que não está hospedado: em produção nenhuma regra
 * era avaliada, e a tela de Alertas deixava o vendedor criar avisos que nunca
 * chegavam. Aqui ela serve aos dois — ao worker, quando ele subir, e à rotina
 * diária da Vercel enquanto isso.
 */
export async function runAlertChecks(): Promise<{ regras: number; disparados: number }> {
  const rules = await prisma.alertRule.findMany({
    where: { isActive: true },
    include: { workspace: { select: { timezone: true } } },
  });

  let disparados = 0;
  const fire = async (title: string, message: string, rule: (typeof rules)[number]) => {
    const tz = rule.workspace.timezone;
    const inicioDeHoje = inicioDoDia(chaveDoDia(new Date(), tz), tz);
    if (await fireAlert(rule.id, rule.workspaceId, rule.severity, title, message, inicioDeHoje)) disparados++;
  };

  for (const rule of rules) {
    const config = (rule.config ?? {}) as Record<string, unknown>;
    // "Ontem" do vendedor: em UTC, o dia vira às 21h de Brasília.
    const tz = rule.workspace.timezone;
    const yesterday = dataDoDia(somarDias(chaveDoDia(new Date(), tz), -1));

    switch (rule.type) {
      case "NET_MARGIN_BELOW": {
        // A tela grava `threshold`; regras antigas usavam `minMarginPercent`.
        // Ler só a chave antiga fazia `margem < undefined` — sempre falso, e
        // o alerta criado pela tela nunca disparava.
        const limite = numero(config.threshold ?? config.minMarginPercent);
        if (limite === null) break;
        const metric = await prisma.dailyMetric.findUnique({
          where: { workspaceId_date: { workspaceId: rule.workspaceId, date: yesterday } },
        });
        if (!metric || Number(metric.grossRevenue) === 0) break;
        const margin = (Number(metric.netProfit) / Number(metric.grossRevenue)) * 100;
        if (margin < limite) {
          await fire(
            "Margem líquida abaixo do esperado",
            `Margem de ontem: ${formatPercent(margin)} (limite: ${formatPercent(limite)}).`,
            rule,
          );
        }
        break;
      }
      case "AD_SPEND_THRESHOLD": {
        const limite = numero(config.threshold ?? config.thresholdAmount);
        if (limite === null) break;
        const metric = await prisma.dailyMetric.findUnique({
          where: { workspaceId_date: { workspaceId: rule.workspaceId, date: yesterday } },
        });
        if (metric && Number(metric.adSpend) > limite) {
          await fire(
            "Gasto com ADS acima do limite",
            `ADS de ontem: ${formatBRL(metric.adSpend)} (limite: ${formatBRL(limite)}).`,
            rule,
          );
        }
        break;
      }
      case "DAILY_REVENUE_ABOVE": {
        const limite = numero(config.threshold ?? config.thresholdAmount);
        if (limite === null) break;
        const metric = await prisma.dailyMetric.findUnique({
          where: { workspaceId_date: { workspaceId: rule.workspaceId, date: yesterday } },
        });
        if (metric && Number(metric.grossRevenue) > limite) {
          await fire(
            "Faturamento diário acima da meta",
            `Faturamento de ontem: ${formatBRL(metric.grossRevenue)} (meta: ${formatBRL(limite)}).`,
            rule,
          );
        }
        break;
      }
      case "NEGATIVE_MARGIN_PRODUCT": {
        const products = await prisma.productMetric.findMany({
          where: { workspaceId: rule.workspaceId, date: yesterday, netProfit: { lt: 0 } },
          include: { product: true },
        });
        for (const p of products) {
          await fire(
            `Produto operando no prejuízo: ${p.product.name}`,
            `SKU ${p.product.sku} — margem ${formatPercent(Number(p.margin))}, perda estimada ${formatBRL(Math.abs(Number(p.netProfit)))}.`,
            rule,
          );
        }
        break;
      }
      case "MARKETPLACE_SYNC_FAILED": {
        const failedAccounts = await prisma.marketplaceAccount.findMany({
          where: { workspaceId: rule.workspaceId, status: { in: ["ERROR", "TOKEN_EXPIRED"] } },
        });
        for (const account of failedAccounts) {
          // O nome da loja, não o enum: "SHOPEE parou de sincronizar" não diz
          // qual das contas é, para quem tem mais de uma.
          await fire(
            `${account.displayName} parou de sincronizar`,
            account.lastErrorMessage ?? "Reconecte a conta em Integrações.",
            rule,
          );
        }
        break;
      }
    }
  }

  return { regras: rules.length, disparados };
}

/**
 * Cria o evento e a notificação, uma vez por dia por título.
 *
 * A severidade é a que o vendedor escolheu ao criar a regra — antes cada tipo
 * tinha a sua fixa, e o campo "Severidade" do formulário não mudava nada.
 */
async function fireAlert(
  alertRuleId: string,
  workspaceId: string,
  severity: AlertSeverity,
  title: string,
  message: string,
  inicioDeHoje: Date,
): Promise<boolean> {
  const existing = await prisma.alertEvent.findFirst({
    where: { alertRuleId, title, triggeredAt: { gte: inicioDeHoje } },
  });
  if (existing) return false;

  await prisma.alertEvent.create({ data: { workspaceId, alertRuleId, severity, title, message } });
  await prisma.notification.create({ data: { workspaceId, title, body: message } });
  return true;
}

function numero(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

// O texto vai para a tela e para a notificação: "R$ 1234.50" com ponto é o
// formato do código, não o do vendedor.
function formatBRL(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;
}
