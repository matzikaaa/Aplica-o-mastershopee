import Decimal from "decimal.js";
import { prisma } from "./index";
import { ensureProductForOrderItem } from "./product-upsert";
import { applySaleToStock, reverseSaleFromStock, type AlvoDeEstoque } from "./stock";
import { snapshotDoCusto, type SnapshotDeCusto } from "./order-profit";

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
  /** Histórico de custo de cada produto, do mais antigo ao mais novo. */
  costs: Map<string, CustoDatado[]>;
  /** Onde cada SKU baixa estoque, e com que multiplicador. */
  alvos: Map<string, AlvoDeEstoque>;
}

type CustoDatado = Parameters<typeof snapshotDoCusto>[0] & { effectiveFrom: Date };

export function createSyncCache(): SyncCache {
  return { products: new Map(), costs: new Map(), alvos: new Map() };
}

/**
 * Resolve o ProductCost vigente em `orderedAt` — nunca o custo atual (§16).
 * Produto sem histórico de custo devolve null, que o dashboard mostra como
 * "sem custo" em vez de tratar como se fosse de graça (§96).
 */
export async function resolverCustoVigente(
  productId: string,
  orderedAt: Date,
  cache?: SyncCache,
): Promise<SnapshotDeCusto | null> {
  // O histórico inteiro do produto, uma consulta por produto na rodada, e a
  // vigência resolvida pelo instante exato da venda. A chave antiga era o dia
  // em UTC — e um custo que vale desde a meia-noite de Brasília (03h UTC)
  // muda no meio desse dia: dois pedidos dele pegariam o mesmo custo.
  let historico = cache?.costs.get(productId);
  if (!historico) {
    historico = await prisma.productCost.findMany({
      where: { productId },
      orderBy: { effectiveFrom: "asc" },
      select: {
        unitCost: true,
        packagingCost: true,
        operationalCost: true,
        otherCosts: true,
        taxPercent: true,
        effectiveFrom: true,
      },
    });
    cache?.costs.set(productId, historico);
  }

  let cost: CustoDatado | undefined;
  for (const c of historico) {
    if (c.effectiveFrom <= orderedAt) cost = c;
    else break;
  }

  // Null, não zero. Zero significa "esta mercadoria não custou nada"; a
  // ausência de custo cadastrado significa "não sabemos quanto custou", e as
  // duas coisas levam a lucros diferentes. Gravar zero aqui fazia o pedido
  // entrar com margem cheia e, pior, ficava invisível para o backfill — que
  // procura por null — então cadastrar o custo depois não recalculava nada.
  return cost ? snapshotDoCusto(cost) : null;
}

/** Só o custo unitário — para quem ainda precisa só dele. */
export async function resolveCostSnapshot(
  productId: string,
  orderedAt: Date,
  cache?: SyncCache,
): Promise<Decimal | null> {
  return (await resolverCustoVigente(productId, orderedAt, cache))?.unitCostSnapshot ?? null;
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
    const custo = product ? await resolverCustoVigente(product.id, o.orderedAt, cache) : null;

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
        ...(custo ?? { unitCostSnapshot: null }),
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
        alvos: cache?.alvos,
        type: o.status === "RETURNED" ? "RETURN_IN" : "CANCELLATION_IN",
        note: `Pedido ${o.externalOrderId} — ${o.status.toLowerCase()}`,
      });
    } else {
      await applySaleToStock({
        workspaceId: account.workspaceId,
        productId: product.id,
        orderItemId,
        units: item.quantity,
        alvos: cache?.alvos,
        occurredAt: o.orderedAt,
        note: `Venda ${account.marketplace} — pedido ${o.externalOrderId}`,
      });
    }
  }
}
