import { prisma, unitsSoldPerProduct } from "@mastershopee/database";
import { averageDailySales, calculateStockCoverage, projectStockoutDate } from "@mastershopee/inventory";
import { isWhatsappConfigured, sendWhatsappMessage, WHATSAPP_NOT_CONFIGURED } from "../whatsapp.js";

/**
 * Reorder watchdog: warns while there is still time to actually place the
 * order. Demand comes from real order items over the trailing window, and
 * the "is it low?" decision lives entirely in @mastershopee/inventory so the
 * dashboard and this job can never disagree.
 *
 * The alert fires once per shortage — `lowStockNotifiedAt` is set here and
 * cleared by any inbound movement (see packages/database/src/stock.ts), so
 * restocking re-arms it without spamming on every scheduler tick.
 */
const SALES_WINDOW_DAYS = 30;

export async function runStockLevelChecks(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { stockItems: { some: {} } },
    select: { id: true, name: true },
  });

  for (const workspace of workspaces) {
    const [items, sold, whatsapp] = await Promise.all([
      prisma.stockItem.findMany({
        where: { workspaceId: workspace.id },
        include: { product: { select: { name: true, sku: true } } },
      }),
      unitsSoldPerProduct(workspace.id, SALES_WINDOW_DAYS),
      prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } }),
    ]);

    for (const item of items) {
      const velocity = averageDailySales(sold.get(item.productId) ?? 0, SALES_WINDOW_DAYS);
      const coverage = calculateStockCoverage({
        quantity: item.quantity,
        averageDailySales: velocity,
        leadTimeDays: item.leadTimeDays,
        safetyDays: item.safetyDays,
      });

      if (!coverage.needsReorder) continue;
      if (item.lowStockNotifiedAt) continue; // already warned; cleared on restock

      const message = buildLowStockMessage({
        workspaceName: workspace.name,
        productName: item.product.name,
        sku: item.product.sku,
        quantity: item.quantity,
        daysOfCover: coverage.daysOfCover,
        leadTimeDays: item.leadTimeDays,
        safetyDays: item.safetyDays,
        suggestedPurchaseUnits: coverage.suggestedPurchaseUnits,
        supplierName: item.supplierName,
        stockoutAt: projectStockoutDate(coverage),
      });

      const title = coverage.isOutOfStock
        ? `Estoque zerado: ${item.product.name}`
        : `Estoque baixo: ${item.product.name}`;

      await prisma.notification.create({
        data: { workspaceId: workspace.id, title, body: message },
      });

      // Mark before sending: a WhatsApp failure must not turn into a fresh
      // alert on every tick. The in-app notification above is already the
      // durable record, and the reason for any send failure is stored below.
      await prisma.stockItem.update({
        where: { id: item.id },
        data: { lowStockNotifiedAt: new Date() },
      });

      if (whatsapp?.verified && whatsapp.phoneNumber) {
        if (!isWhatsappConfigured()) {
          await prisma.integrationLog.create({
            data: {
              workspaceId: workspace.id,
              level: "warn",
              message: `Alerta de estoque de ${item.product.sku} não enviado por WhatsApp: ${WHATSAPP_NOT_CONFIGURED}`,
            },
          });
        } else {
          try {
            await sendWhatsappMessage(whatsapp.phoneNumber, message);
          } catch (err) {
            await prisma.integrationLog.create({
              data: {
                workspaceId: workspace.id,
                level: "error",
                message: `Falha ao enviar alerta de estoque por WhatsApp: ${err instanceof Error ? err.message : "erro desconhecido"}`,
              },
            });
          }
        }
      }
    }
  }
}

export function buildLowStockMessage(input: {
  workspaceName: string;
  productName: string;
  sku: string;
  quantity: number;
  daysOfCover: number | null;
  leadTimeDays: number;
  safetyDays: number;
  suggestedPurchaseUnits: number | null;
  supplierName?: string | null;
  stockoutAt: Date | null;
}): string {
  const lines: string[] = [];

  lines.push(
    input.quantity <= 0
      ? `🚨 Estoque ZERADO em ${input.workspaceName}`
      : `⚠️ Estoque baixo em ${input.workspaceName}`,
  );
  lines.push(`📦 ${input.productName} (${input.sku})`);
  lines.push(`Saldo atual: ${input.quantity} un.`);

  if (input.daysOfCover !== null) {
    lines.push(`⏳ Cobertura: ${formatDays(input.daysOfCover)} no ritmo de venda atual`);
  }
  if (input.stockoutAt) {
    lines.push(`📅 Previsão de ruptura: ${formatDate(input.stockoutAt)}`);
  }

  const supplier = input.supplierName ? ` (${input.supplierName})` : "";
  lines.push(`🚚 Reposição${supplier} leva ${input.leadTimeDays} dia(s) + ${input.safetyDays} de folga`);

  if (input.suggestedPurchaseUnits && input.suggestedPurchaseUnits > 0) {
    lines.push(`🛒 Sugestão de compra: ${input.suggestedPurchaseUnits} un.`);
  }

  lines.push("Registre a entrada no painel assim que a carga chegar.");
  return lines.join("\n");
}

function formatDays(days: number): string {
  if (days < 1) return "menos de 1 dia";
  const rounded = Math.floor(days);
  return `${rounded} dia${rounded === 1 ? "" : "s"}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
