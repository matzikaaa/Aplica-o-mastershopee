import { prisma } from "./index";
import { backfillMissingCostSnapshots, recomputeMetricsForDays } from "./metrics";
import { countItemsWithUnknownCost } from "./order-status";

/**
 * Declara que o primeiro custo de cada produto já valia na primeira venda
 * dele, e preenche as vendas que ficaram sem custo.
 *
 * Custo é vigente por data (§16): um custo cadastrado hoje não vale para uma
 * venda de maio. É o padrão certo — a aplicação não tem como saber quanto um
 * produto custou três meses atrás. Mas quem está carregando o histórico pela
 * primeira vez sabe, e é assim que diz.
 *
 * Retroage a linha de custo real em vez de preencher snapshots por baixo dos
 * panos, para a mudança aparecer no histórico de custos do produto em vez de
 * se esconder dentro dos pedidos.
 *
 * Vive aqui, e não na rota, porque foi dentro da rota que um `continue` fora
 * de lugar sobreviveu: ele pulava o preenchimento sempre que o custo já
 * começava antes da primeira venda — exatamente o caso de quem cadastra custo
 * com data retroativa depois de importar os pedidos. Lógica em rota não tem
 * teste; aqui tem.
 */
export async function aplicarCustosAoHistorico(workspaceId: string) {
  const products = await prisma.product.findMany({
    where: { workspaceId, costs: { some: {} } },
    select: {
      id: true,
      costs: { orderBy: { effectiveFrom: "asc" }, take: 1, select: { id: true, effectiveFrom: true } },
    },
  });

  let backdated = 0;
  const touchedDays = new Set<string>();

  for (const product of products) {
    const earliestCost = product.costs[0];
    if (!earliestCost) continue;

    const firstSale = await prisma.orderItem.findFirst({
      where: { productId: product.id },
      orderBy: { order: { orderedAt: "asc" } },
      select: { order: { select: { orderedAt: true } } },
    });
    if (!firstSale) continue;

    const firstSaleAt = firstSale.order.orderedAt;

    // Retroagir é condicional; preencher não é. "O custo é antigo o bastante"
    // e "os itens já têm o custo gravado" são coisas diferentes.
    if (earliestCost.effectiveFrom > firstSaleAt) {
      await prisma.productCost.update({
        where: { id: earliestCost.id },
        data: { effectiveFrom: firstSaleAt },
      });
      backdated++;
    }

    for (const day of await backfillMissingCostSnapshots(product.id)) touchedDays.add(day);
  }

  const daysRecomputed = await recomputeMetricsForDays(workspaceId, touchedDays);
  const stillMissing = await countItemsWithUnknownCost(workspaceId);

  return { backdated, daysRecomputed, stillMissing };
}
