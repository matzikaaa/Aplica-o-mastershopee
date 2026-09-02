import { averageDailySales, calculateStockCoverage, projectStockoutDate } from "@mastershopee/inventory";
import { prisma } from "./index";
import { unitsSoldPerProduct } from "./stock";

/**
 * Produtos que precisam de reposição, com a mesma conta que o painel usa.
 *
 * Vivia dentro do job do worker. Passou para cá quando o aviso de estoque
 * deixou de ser uma mensagem por produto ao longo do dia e virou parte do
 * resumo da manhã — o worker não está hospedado, e a decisão "está baixo?"
 * não pode ter duas implementações, senão o painel diz uma coisa e o
 * WhatsApp diz outra.
 */
const SALES_WINDOW_DAYS = 30;

export interface LowStockItem {
  stockItemId: string;
  productName: string;
  sku: string;
  quantity: number;
  daysOfCover: number | null;
  suggestedPurchaseUnits: number | null;
  supplierName: string | null;
  leadTimeDays: number;
  isOutOfStock: boolean;
  stockoutAt: Date | null;
}

export async function collectLowStock(workspaceId: string): Promise<LowStockItem[]> {
  const [items, sold] = await Promise.all([
    prisma.stockItem.findMany({
      where: { workspaceId },
      include: { product: { select: { name: true, sku: true } } },
    }),
    unitsSoldPerProduct(workspaceId, SALES_WINDOW_DAYS),
  ]);

  const baixos: LowStockItem[] = [];

  for (const item of items) {
    const coverage = calculateStockCoverage({
      quantity: item.quantity,
      averageDailySales: averageDailySales(sold.get(item.productId) ?? 0, SALES_WINDOW_DAYS),
      leadTimeDays: item.leadTimeDays,
      safetyDays: item.safetyDays,
    });
    if (!coverage.needsReorder) continue;

    baixos.push({
      stockItemId: item.id,
      productName: item.product.name,
      sku: item.product.sku,
      quantity: item.quantity,
      daysOfCover: coverage.daysOfCover,
      suggestedPurchaseUnits: coverage.suggestedPurchaseUnits,
      supplierName: item.supplierName,
      leadTimeDays: item.leadTimeDays,
      isOutOfStock: coverage.isOutOfStock,
      stockoutAt: projectStockoutDate(coverage),
    });
  }

  // Zerado primeiro, depois o que acaba antes: é a ordem em que o vendedor
  // precisa agir, e a mensagem tem espaço limitado.
  return baixos.sort((a, b) => {
    if (a.isOutOfStock !== b.isOutOfStock) return a.isOutOfStock ? -1 : 1;
    return (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity);
  });
}

/**
 * Marca os itens como avisados, para o alerta não repetir todo dia.
 *
 * `lowStockNotifiedAt` é limpo por qualquer entrada de estoque (ver
 * stock.ts), então repor rearma o aviso sem precisar de nada aqui.
 */
export async function markLowStockNotified(stockItemIds: string[]): Promise<void> {
  if (stockItemIds.length === 0) return;
  await prisma.stockItem.updateMany({
    where: { id: { in: stockItemIds } },
    data: { lowStockNotifiedAt: new Date() },
  });
}
