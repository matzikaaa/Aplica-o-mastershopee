import Decimal from "decimal.js";
import { prisma } from "./index";
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
 * Resolve o ProductCost vigente em `orderedAt` — nunca o custo atual (§16).
 * Produto sem histórico de custo devolve zero, que o dashboard mostra como
 * "sem custo" em vez de tratar como se fosse de graça (§96).
 */
export async function resolveCostSnapshot(productId: string, orderedAt: Date): Promise<Decimal> {
  const cost = await prisma.productCost.findFirst({
    where: { productId, effectiveFrom: { lte: orderedAt } },
    orderBy: { effectiveFrom: "desc" },
  });
  return cost ? new Decimal(cost.unitCost) : new Decimal(0);
}

export async function upsertNormalizedOrder(
  account: UpsertOrderAccount,
  o: UpsertOrderInput,
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
    const product = await prisma.product.findUnique({
      where: { workspaceId_sku: { workspaceId: account.workspaceId, sku: item.externalSku } },
    });
    const unitCostSnapshot = product ? await resolveCostSnapshot(product.id, o.orderedAt) : new Decimal(0);

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
