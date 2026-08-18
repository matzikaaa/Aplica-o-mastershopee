import { prisma } from "@mastershopee/database";

/**
 * Evaluates every active AlertRule against yesterday's pre-aggregated
 * metrics (§24-25) and creates AlertEvent + Notification rows when a
 * condition fires. Runs periodically (see scheduler.ts) rather than per
 * request — alerts are inherently a background concern.
 */
export async function runAlertChecks(): Promise<void> {
  const rules = await prisma.alertRule.findMany({ where: { isActive: true } });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  for (const rule of rules) {
    const config = rule.config as Record<string, number>;

    switch (rule.type) {
      case "NET_MARGIN_BELOW": {
        const metric = await prisma.dailyMetric.findUnique({
          where: { workspaceId_date: { workspaceId: rule.workspaceId, date: yesterday } },
        });
        if (!metric || Number(metric.grossRevenue) === 0) break;
        const margin = (Number(metric.netProfit) / Number(metric.grossRevenue)) * 100;
        if (margin < config.minMarginPercent!) {
          await fireAlert(rule.id, rule.workspaceId, "IMPORTANT", "Margem líquida abaixo do esperado", `Margem de ontem: ${margin.toFixed(1)}% (limite: ${config.minMarginPercent}%).`);
        }
        break;
      }
      case "AD_SPEND_THRESHOLD": {
        const metric = await prisma.dailyMetric.findUnique({
          where: { workspaceId_date: { workspaceId: rule.workspaceId, date: yesterday } },
        });
        if (metric && Number(metric.adSpend) > config.threshold!) {
          await fireAlert(rule.id, rule.workspaceId, "IMPORTANT", "Gasto com ADS acima do limite", `ADS de ontem: R$ ${Number(metric.adSpend).toFixed(2)} (limite: R$ ${config.threshold}).`);
        }
        break;
      }
      case "DAILY_REVENUE_ABOVE": {
        const metric = await prisma.dailyMetric.findUnique({
          where: { workspaceId_date: { workspaceId: rule.workspaceId, date: yesterday } },
        });
        if (metric && Number(metric.grossRevenue) > config.threshold!) {
          await fireAlert(rule.id, rule.workspaceId, "INFORMATIVE", "Faturamento diário recorde", `Faturamento de ontem: R$ ${Number(metric.grossRevenue).toFixed(2)}.`);
        }
        break;
      }
      case "NEGATIVE_MARGIN_PRODUCT": {
        const products = await prisma.productMetric.findMany({
          where: { workspaceId: rule.workspaceId, date: yesterday, netProfit: { lt: 0 } },
          include: { product: true },
        });
        for (const p of products) {
          await fireAlert(
            rule.id,
            rule.workspaceId,
            "CRITICAL",
            `Produto operando no prejuízo: ${p.product.name}`,
            `SKU ${p.product.sku} — margem ${Number(p.margin).toFixed(1)}%, perda estimada R$ ${Math.abs(Number(p.netProfit)).toFixed(2)}.`,
          );
        }
        break;
      }
      case "MARKETPLACE_SYNC_FAILED": {
        const failedAccounts = await prisma.marketplaceAccount.findMany({
          where: { workspaceId: rule.workspaceId, status: { in: ["ERROR", "TOKEN_EXPIRED"] } },
        });
        for (const account of failedAccounts) {
          await fireAlert(
            rule.id,
            rule.workspaceId,
            "CRITICAL",
            `${account.marketplace} parou de sincronizar`,
            account.lastErrorMessage ?? "Reconecte a conta em Integrações.",
          );
        }
        break;
      }
    }
  }
}

async function fireAlert(alertRuleId: string, workspaceId: string, severity: "CRITICAL" | "IMPORTANT" | "INFORMATIVE", title: string, message: string) {
  // Avoid re-firing the exact same alert every run within the same day.
  const existing = await prisma.alertEvent.findFirst({
    where: { alertRuleId, title, triggeredAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  if (existing) return;

  await prisma.alertEvent.create({ data: { workspaceId, alertRuleId, severity, title, message } });
  await prisma.notification.create({ data: { workspaceId, title, body: message } });
}
