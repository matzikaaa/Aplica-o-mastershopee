import Decimal from "decimal.js";
import { prisma } from "./index";
import { ensureProductForOrderItem } from "./product-upsert";
import { applySaleToStock, reverseSaleFromStock } from "./stock";

/**
 * A gravação de um pedido do marketplace, num lugar só.
 *
 * Isto era um bloco dentro do job do worker. Passou a viver aqui quando a
 * sincronização também passou a poder rodar direto na aplicação web — duas
 * cópias da lógica que grava dinheiro divergem, e a divergência aparece como
 * lucro diferente dependendo de quem sincronizou.
 *
 * O tipo de entrada é estrutural de propósito: este pacote não conhece
 * `@mastershopee/integrations`, e inverter essa dependência só para importar
 * um tipo colocaria o Prisma dentro do pacote de integrações.
 */

/** Status em que o marketplace devolveu as unidades ao vendedor. */
const STOCK_RELEASING_STATUSES = ["CANCELED", "REFUNDED", "RETURNED"];

export interface UpsertOrderItemInput {
  externalSku: string;
  externalVariationId?: string;
  title: string;
  quantity: number;
  unitPrice: string;
  commissionAmount: string;
  feeAmount: string;
  taxAmount: string;
}

export interface UpsertOrderInput {
  externalOrderId: string;
  status: string;
  orderedAt: Date;
  currency: string;
  grossAmount: string;
  discountAmount: string;
  shippingChargedToBuyer: string;
  shippingSubsidizedByMerchant: string;
  commissionAmount: string;
  marketplaceFeeAmount: string;
  taxAmount: string;
  /** Falso quando o marketplace ainda não confirmou as taxas deste pedido. */
  feesFromEscrow?: boolean;
  items: UpsertOrderItemInput[];
  raw: unknown;
}

export interface UpsertOrderAccount {
  id: string;
  workspaceId: string;
  marketplace: string;
}

/**
 * Memória de uma rodada de sincronização.
 *
 * Um vendedor com 15 SKUs e 400 pedidos fazia 400 consultas de produto e 400
 * de custo — quase todas repetindo a mesma pergunta, porque o mesmo SKU
 * aparece em dezenas de pedidos. Cada ida ao Postgres da Vercel é uma ida e
 * volta de rede, e é isso que fazia a importação estourar o tempo da função.
 *
 * O cache vive numa rodada só. Nada nele sobrevive à requisição, então não há
 * o risco de servir um custo desatualizado depois que o vendedor o corrigir.
 */
export interface SyncCache {
  products: Map<string, string | null>;
  costs: Map<string, Decimal>;
}

export function createSyncCache(): SyncCache {
  return { products: new Map(), costs: new Map() };
}

/**
 * Resolve o ProductCost vigente em `orderedAt` — nunca o custo atual (§16).
 * Produto sem histórico de custo devolve zero, que o dashboard mostra como
 * "sem custo" em vez de tratar como se fosse de graça (§96).
 */
export async function resolveCostSnapshot(
  productId: string,
  orderedAt: Date,
  cache?: SyncCache,
): Promise<Decimal> {
  // Dia basta como chave: o custo é vigente por data, não por hora.
  const key = `${productId}:${orderedAt.toISOString().slice(0, 10)}`;
  const cached = cache?.costs.get(key);
  if (cached) return cached;

  const cost = await prisma.productCost.findFirst({
    where: { productId, effectiveFrom: { lte: orderedAt } },
    orderBy: { effectiveFrom: "desc" },
  });
  const valor = cost ? new Decimal(cost.unitCost) : new Decimal(0);
  cache?.costs.set(key, valor);
  return valor;
}

export async function upsertNormalizedOrder(
  account: UpsertOrderAccount,
  o: UpsertOrderInput,
  cache?: SyncCache,
): Promise<void> {
  const money = {
    status: o.status as never,
    grossAmount: o.grossAmount,
    discountAmount: o.discountAmount,
    shippingChargedToBuyer: o.shippingChargedToBuyer,
    shippingSubsidizedByMerchant: o.shippingSubsidizedByMerchant,
    commissionAmount: o.commissionAmount,
    marketplaceFeeAmount: o.marketplaceFeeAmount,
    taxAmount: o.taxAmount,
    // `feesFromEscrow` ausente (planilha, outro marketplace) significa que as
    // taxas vieram do relatório do próprio marketplace: são reais.
    feesAreEstimated: o.feesFromEscrow === false,
    rawPayload: JSON.parse(JSON.stringify(o.raw ?? {})) as never,
  };

  const order = await prisma.order.upsert({
    where: {
      marketplaceAccountId_externalOrderId: {
        marketplaceAccountId: account.id,
        externalOrderId: o.externalOrderId,
      },
    },
    update: money,
    create: {
      ...money,
      workspaceId: account.workspaceId,
      marketplaceAccountId: account.id,
      marketplace: account.marketplace as never,
      externalOrderId: o.externalOrderId,
      orderedAt: o.orderedAt,
      currency: o.currency,
    },
  });

  for (const item of o.items) {
    // Todo SKU vendido vira produto. Sem isto, um SKU que não está no
    // catálogo sincronizado some: o pedido entra sem produto, sem custo, e
    // sem aparecer em lugar nenhum para o vendedor perceber que falta
    // preencher. O produto nasce sem custo, marcado como tal no painel.
    let productId = cache?.products.get(item.externalSku);
    if (productId === undefined) {
      productId = await ensureProductForOrderItem(account.workspaceId, item.externalSku, item.title);
      cache?.products.set(item.externalSku, productId);
    }
    const product = productId ? { id: productId } : null;
    const unitCostSnapshot = product ? await resolveCostSnapshot(product.id, o.orderedAt, cache) : new Decimal(0);

    const orderItemId = `${order.id}:${item.externalSku}:${item.externalVariationId ?? ""}`;
    await prisma.orderItem.upsert({
      where: { id: orderItemId },
      update: {},
      create: {
        id: orderItemId,
        orderId: order.id,
        productId: product?.id,
        externalSku: item.externalSku,
        title: item.title,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCostSnapshot,
        commissionAmount: item.commissionAmount,
        feeAmount: item.feeAmount,
        taxAmount: item.taxAmount,
      },
    });

    // O estoque segue a venda, chaveado por orderItemId para que
    // ressincronizar o mesmo pedido nunca debite as mesmas unidades duas
    // vezes (§87). Só produtos já conhecidos do workspace movem estoque — um
    // SKU do marketplace sem Product correspondente não tem o que debitar.
    if (!product) continue;

    if (STOCK_RELEASING_STATUSES.includes(o.status)) {
      await reverseSaleFromStock({
        workspaceId: account.workspaceId,
        productId: product.id,
        orderItemId,
        units: item.quantity,
        type: o.status === "RETURNED" ? "RETURN_IN" : "CANCELLATION_IN",
        note: `Pedido ${o.externalOrderId} — ${o.status.toLowerCase()}`,
      });
    } else {
      await applySaleToStock({
        workspaceId: account.workspaceId,
        productId: product.id,
        orderItemId,
        units: item.quantity,
        occurredAt: o.orderedAt,
        note: `Venda ${account.marketplace} — pedido ${o.externalOrderId}`,
      });
    }
  }
}
