import { Money } from "@mastershopee/shared";
import type { NormalizedOrder, NormalizedOrderItem } from "../types";

/**
 * Onde a Shopee guarda cada número, e por que são duas chamadas.
 *
 * `get_order_detail` devolve o que o comprador comprou e pagou: itens,
 * quantidades, preços com e sem desconto, status e datas. Não devolve o que a
 * Shopee cobrou do vendedor.
 *
 * As taxas — comissão, taxa de serviço, taxa de transação — só existem em
 * `get_escrow_detail`, que é por pedido. Sem essa segunda chamada o pedido
 * entra com receita cheia e taxa zero, o que infla o lucro exatamente nos
 * pedidos que mais pesam. Por isso `feesFromEscrow` viaja junto com o pedido:
 * quando o escrow não veio, o número é receita sem taxa e a aplicação precisa
 * saber disso em vez de apresentar como resultado real.
 */

/** Status da Shopee → status interno. */
export function normalizeShopeeStatus(status: string): NormalizedOrder["status"] {
  switch (status) {
    case "UNPAID":
      return "CREATED";
    case "READY_TO_SHIP":
    case "PROCESSED":
    case "RETRY_SHIP":
    case "INVOICE_PENDING":
      return "PAID";
    case "SHIPPED":
    case "TO_CONFIRM_RECEIVE":
      return "SHIPPED";
    case "COMPLETED":
      return "DELIVERED";
    case "IN_CANCEL":
    case "CANCELLED":
      return "CANCELED";
    case "TO_RETURN":
      return "RETURNED";
    default:
      // Um status novo tratado como entregue viraria receita silenciosamente.
      // CREATED é o único palpite que não inventa dinheiro.
      return "CREATED";
  }
}

export interface ShopeeOrderItemRaw {
  item_id?: number;
  item_name?: string;
  item_sku?: string;
  model_id?: number;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
  model_original_price?: number;
  model_discounted_price?: number;
}

export interface ShopeeOrderDetailRaw {
  order_sn: string;
  order_status?: string;
  create_time?: number;
  update_time?: number;
  currency?: string;
  total_amount?: number;
  actual_shipping_fee?: number;
  estimated_shipping_fee?: number;
  item_list?: ShopeeOrderItemRaw[];
}

export interface ShopeeEscrowRaw {
  order_sn?: string;
  order_income?: {
    /** O que a Shopee de fato repassa ao vendedor. É a âncora do cálculo. */
    escrow_amount?: number;
    order_selling_price?: number;
    buyer_total_amount?: number;
    buyer_paid_shipping_fee?: number;
    actual_shipping_fee?: number;
    shopee_shipping_rebate?: number;
    seller_shipping_discount?: number;
    commission_fee?: number;
    service_fee?: number;
    seller_transaction_fee?: number;
  };
}

const money = (value: number | undefined, currency: string) => Money.of(value ?? 0, currency);

/**
 * Dados do comprador que a Shopee devolve junto e que esta aplicação não usa
 * para nada: nome, telefone, documento e endereço de entrega.
 *
 * O payload cru é guardado em Order.rawPayload para permitir recalcular sem
 * ressincronizar. Guardar junto o endereço de cada comprador seria acumular
 * dado pessoal sem finalidade — e sem finalidade não há base legal para
 * tratar (LGPD art. 6º, I e III). O que serve ao cálculo fica; o resto não
 * chega ao banco.
 */
const PERSONAL_DATA_KEYS = new Set([
  "recipient_address",
  "buyer_username",
  // A chave real no escrow é esta, com underscore no meio de "user_name".
  "buyer_user_name",
  "buyer_payment_info",
  "buyer_user_id",
  "buyer_cpf_id",
  "buyer_email",
  "buyer_phone",
  "note",
  "message_to_seller",
]);

export function stripShopeePersonalData<T>(payload: T): T {
  if (Array.isArray(payload)) return payload.map(stripShopeePersonalData) as unknown as T;
  if (payload === null || typeof payload !== "object") return payload;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (PERSONAL_DATA_KEYS.has(key)) continue;
    out[key] = stripShopeePersonalData(value);
  }
  return out as T;
}

/**
 * O SKU é a chave que liga o pedido ao custo cadastrado. A Shopee tem dois:
 * o da variação (`model_sku`) e o do item (`item_sku`). Quem vende variações
 * cadastra o custo por variação, então ela vem primeiro; o item_id é o último
 * recurso, para não perder a linha quando o vendedor não preencheu SKU nenhum.
 */
export function resolveShopeeSku(item: ShopeeOrderItemRaw): string {
  const candidates = [item.model_sku, item.item_sku].map((s) => s?.trim()).filter((s): s is string => Boolean(s));
  return candidates[0] ?? String(item.item_id ?? "");
}

export function normalizeShopeeOrder(
  detail: ShopeeOrderDetailRaw,
  escrow: ShopeeEscrowRaw | null,
): NormalizedOrder & { feesFromEscrow: boolean } {
  const currency = detail.currency ?? "BRL";
  const rawItems = detail.item_list ?? [];

  let gross = Money.zero(currency);
  let discount = Money.zero(currency);
  const items: NormalizedOrderItem[] = [];

  for (const raw of rawItems) {
    const quantity = raw.model_quantity_purchased ?? 0;
    const original = money(raw.model_original_price, currency);
    // A Shopee manda 0 em `model_discounted_price` quando não houve desconto,
    // e 0 aqui não significa item de graça.
    const discounted = raw.model_discounted_price ? money(raw.model_discounted_price, currency) : original;

    gross = gross.add(original.multiply(quantity));
    discount = discount.add(original.subtract(discounted).multiply(quantity));

    items.push({
      externalSku: resolveShopeeSku(raw),
      externalProductId: String(raw.item_id ?? ""),
      externalVariationId: raw.model_id ? String(raw.model_id) : undefined,
      title: raw.model_name ? `${raw.item_name ?? ""} — ${raw.model_name}`.trim() : (raw.item_name ?? ""),
      quantity,
      unitPrice: discounted.toFixed(4),
      // A Shopee cobra taxa por pedido, não por item. Ratear aqui produziria
      // um número que ela nunca cobrou; o valor real fica no pedido.
      commissionAmount: "0",
      feeAmount: "0",
      taxAmount: "0",
    });
  }

  const income = escrow?.order_income;
  const feesFromEscrow = Boolean(income);

  const commission = money(income?.commission_fee, currency);

  const buyerPaidShipping = income
    ? money(income.buyer_paid_shipping_fee, currency)
    : money(detail.estimated_shipping_fee, currency);

  // O que sobrou do frete real depois do que o comprador pagou e do que a
  // Shopee subsidiou sai do bolso do vendedor. Nunca negativo: quando o
  // subsídio cobre tudo, o vendedor não recebe troco.
  const actualShipping = money(income?.actual_shipping_fee, currency);
  const shopeeRebate = money(income?.shopee_shipping_rebate, currency);
  const uncovered = actualShipping.subtract(buyerPaidShipping).subtract(shopeeRebate);
  const merchantShipping = income
    ? money(income.seller_shipping_discount, currency).add(uncovered.isNegative() ? Money.zero(currency) : uncovered)
    : Money.zero(currency);

  // As taxas saem do que a Shopee diz que vai repassar, não de uma soma de
  // campos escolhidos a dedo.
  //
  // `order_income` tem mais de oitenta chaves e a Shopee acrescenta novas sem
  // aviso. Somar commission + service + transaction parecia bater, e não
  // batia: faltava `shipping_seller_protection_fee_amount`, R$ 0,49 por
  // pedido que sumia do custo e reaparecia como lucro. Uma lista de campos
  // erra sempre para o mesmo lado — para menos taxa, mais lucro.
  //
  // `escrow_amount` é o número que cai na conta do vendedor. Derivar as taxas
  // dele fecha por construção: o que a Shopee reteve é o que ela não
  // repassou, seja qual for o nome que ela deu à retenção.
  const sellingPrice =
    income?.order_selling_price != null ? money(income.order_selling_price, currency) : gross.subtract(discount);
  const escrowAmount = money(income?.escrow_amount, currency);
  const canReconcile = (income?.escrow_amount ?? 0) > 0;

  let otherFees: Money;
  if (canReconcile) {
    const withheld = sellingPrice.add(buyerPaidShipping).subtract(escrowAmount);
    const rest = withheld.subtract(commission).subtract(merchantShipping);
    // Um resíduo negativo significaria que o frete por conta do vendedor já
    // foi contado em outro lugar; zerar aqui evita virar taxa negativa, que
    // apareceria como lucro extra.
    otherFees = rest.isNegative() ? Money.zero(currency) : rest;
  } else {
    otherFees = money(income?.service_fee, currency).add(money(income?.seller_transaction_fee, currency));
  }

  return {
    externalOrderId: detail.order_sn,
    marketplace: "SHOPEE",
    status: normalizeShopeeStatus(detail.order_status ?? ""),
    orderedAt: new Date((detail.create_time ?? 0) * 1000),
    currency,
    grossAmount: gross.toFixed(4),
    discountAmount: discount.toFixed(4),
    shippingChargedToBuyer: buyerPaidShipping.toFixed(4),
    shippingSubsidizedByMerchant: merchantShipping.toFixed(4),
    commissionAmount: commission.toFixed(4),
    marketplaceFeeAmount: otherFees.toFixed(4),
    taxAmount: "0",
    items,
    feesFromEscrow,
    // O payload financeiro fica guardado: se algum mapeamento acima estiver
    // errado, dá para recalcular sem sincronizar tudo de novo. Os dados do
    // comprador saem antes — não entram em nenhuma conta e não têm por que
    // ficar no banco.
    raw: stripShopeePersonalData({ detail, escrow }),
  };
}
