import Decimal from "decimal.js";
import {
  financialEngine,
  type OrderEconomicsInput,
  type OrderEconomicsResult,
} from "@mastershopee/financial-engine";

type Valor = Decimal | Decimal.Value | { toString(): string };

const dec = (v: Valor | null | undefined) => new Decimal(v === null || v === undefined ? 0 : v.toString());

/**
 * O custo vigente numa data, inteiro, do jeito que vai congelado no item.
 *
 * Só o custo unitário era congelado: embalagem, custo operacional, outros
 * custos e imposto ficavam no cadastro e nunca chegavam ao lucro.
 */
export interface SnapshotDeCusto {
  unitCostSnapshot: Decimal;
  packagingCostSnapshot: Decimal;
  operationalCostSnapshot: Decimal;
  otherCostsSnapshot: Decimal;
  taxPercentSnapshot: Decimal;
}

/** Registro de ProductCost → campos de snapshot do OrderItem. */
export function snapshotDoCusto(cost: {
  unitCost: Valor;
  packagingCost: Valor;
  operationalCost: Valor;
  otherCosts: Valor;
  taxPercent: Valor;
}): SnapshotDeCusto {
  return {
    unitCostSnapshot: dec(cost.unitCost),
    packagingCostSnapshot: dec(cost.packagingCost),
    operationalCostSnapshot: dec(cost.operationalCost),
    otherCostsSnapshot: dec(cost.otherCosts),
    taxPercentSnapshot: dec(cost.taxPercent),
  };
}

/** O que o cálculo precisa de um item vendido. */
export interface ItemParaCalculo {
  quantity: number;
  unitPrice: Valor;
  unitCostSnapshot: Valor | null;
  packagingCostSnapshot: Valor | null;
  operationalCostSnapshot: Valor | null;
  otherCostsSnapshot: Valor | null;
  taxPercentSnapshot: Valor | null;
}

/** O que o cálculo precisa de um pedido — e só isso, para caber em `select`. */
export interface PedidoParaCalculo {
  grossAmount: Valor;
  discountAmount: Valor;
  commissionAmount: Valor;
  marketplaceFeeAmount: Valor;
  shippingSubsidizedByMerchant: Valor;
  taxAmount: Valor;
  adSpendAttributed: Valor;
  items: ItemParaCalculo[];
  refunds?: { amount: Valor }[];
}

/** Custos por unidade do item, como o motor recebe. */
function custoDoItem(item: ItemParaCalculo) {
  return {
    quantity: item.quantity,
    unitCost: dec(item.unitCostSnapshot),
    packagingCost: dec(item.packagingCostSnapshot),
    operationalCost: dec(item.operationalCostSnapshot),
    otherCosts: dec(item.otherCostsSnapshot),
  };
}

/**
 * Imposto do vendedor sobre a venda do item (ex.: alíquota do Simples).
 *
 * Soma-se ao imposto que o marketplace informa no pedido: são coisas
 * diferentes — o da Shopee vem zerado, e o do Simples é do vendedor.
 */
function impostoDoItem(item: ItemParaCalculo): Decimal {
  const pct = dec(item.taxPercentSnapshot);
  if (pct.isZero()) return new Decimal(0);
  return dec(item.unitPrice).times(item.quantity).times(pct).dividedBy(100);
}

/**
 * Pedido do banco → entrada do motor financeiro, num lugar só (§60).
 *
 * A lista de pedidos montava a própria versão e esquecia os reembolsos: um
 * pedido reembolsado mostrava um lucro na lista e outro no detalhe. As
 * métricas diárias, o detalhe, a lista e a exportação passam todos por aqui.
 *
 * Custo desconhecido entra como zero no cálculo — e por isso quem exibe o
 * resultado tem que marcar o pedido (ver `costIsUnknown`), nunca apresentar
 * esse lucro como fechado.
 */
export function entradaFinanceiraDoPedido(order: PedidoParaCalculo): OrderEconomicsInput {
  return {
    grossAmount: dec(order.grossAmount),
    discountAmount: dec(order.discountAmount),
    commissionAmount: dec(order.commissionAmount),
    marketplaceFeeAmount: dec(order.marketplaceFeeAmount),
    shippingSubsidizedByMerchant: dec(order.shippingSubsidizedByMerchant),
    taxAmount: order.items.reduce((acc, i) => acc.plus(impostoDoItem(i)), dec(order.taxAmount)),
    adSpendAttributed: dec(order.adSpendAttributed),
    refundAmount: (order.refunds ?? []).reduce((acc, r) => acc.plus(dec(r.amount)), new Decimal(0)),
    items: order.items.map(custoDoItem),
  };
}

export function calcularPedido(order: PedidoParaCalculo): OrderEconomicsResult {
  return financialEngine.calculateOrder(entradaFinanceiraDoPedido(order));
}

/** Item vendido com as taxas do próprio item — para o lucro por produto. */
export interface ItemComTaxas extends ItemParaCalculo {
  commissionAmount: Valor;
  feeAmount: Valor;
  taxAmount: Valor;
  adSpendAttributed: Valor;
}

/**
 * Lucro de um item isolado (ranking e métricas por produto). Mesmas parcelas
 * do pedido, para o produto não parecer mais lucrativo que os pedidos dele.
 */
export function calcularItem(item: ItemComTaxas): OrderEconomicsResult {
  return financialEngine.calculateOrder({
    grossAmount: dec(item.unitPrice).times(item.quantity),
    commissionAmount: dec(item.commissionAmount),
    marketplaceFeeAmount: dec(item.feeAmount),
    taxAmount: dec(item.taxAmount).plus(impostoDoItem(item)),
    adSpendAttributed: dec(item.adSpendAttributed),
    items: [custoDoItem(item)],
  });
}
