import { describe, expect, it } from "vitest";
import { normalizeShopeeOrder, normalizeShopeeStatus, resolveShopeeSku } from "../providers/shopee-orders";

const detail = {
  order_sn: "2408AB1CD2EF",
  order_status: "COMPLETED",
  create_time: 1_723_000_000,
  currency: "BRL",
  estimated_shipping_fee: 12.9,
  item_list: [
    {
      item_id: 111,
      item_name: "Kit 1 Rolo",
      item_sku: "LAVANDROLL-1",
      model_id: 222,
      model_name: "Lavanda",
      model_sku: "LAVANDROLL-1-LAV",
      model_quantity_purchased: 2,
      model_original_price: 49.9,
      model_discounted_price: 39.9,
    },
  ],
};

const escrow = {
  order_sn: "2408AB1CD2EF",
  order_income: {
    commission_fee: 8.5,
    service_fee: 1.6,
    seller_transaction_fee: 0.4,
    buyer_paid_shipping_fee: 9.9,
    actual_shipping_fee: 21.4,
    shopee_shipping_rebate: 5.0,
    seller_shipping_discount: 2.0,
  },
};

describe("normalizeShopeeOrder", () => {
  it("soma receita e desconto por item, em Decimal", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    expect(o.grossAmount).toBe("99.8000"); // 49.90 × 2
    expect(o.discountAmount).toBe("20.0000"); // (49.90 − 39.90) × 2
    expect(o.items[0]!.unitPrice).toBe("39.9000");
    expect(o.items[0]!.quantity).toBe(2);
  });

  it("tira as taxas do escrow — comissão separada das demais", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    expect(o.commissionAmount).toBe("8.5000");
    expect(o.marketplaceFeeAmount).toBe("2.0000"); // serviço + transação
    expect(o.feesFromEscrow).toBe(true);
  });

  it("cobra do vendedor só o frete que sobrou depois do comprador e do subsídio", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    expect(o.shippingChargedToBuyer).toBe("9.9000");
    // desconto do vendedor 2.00 + (21.40 real − 9.90 comprador − 5.00 rebate)
    expect(o.shippingSubsidizedByMerchant).toBe("8.5000");
  });

  it("não devolve frete negativo quando o subsídio cobre tudo", () => {
    const o = normalizeShopeeOrder(detail, {
      order_income: { ...escrow.order_income, actual_shipping_fee: 5, shopee_shipping_rebate: 30 },
    });
    expect(o.shippingSubsidizedByMerchant).toBe("2.0000"); // só o desconto do vendedor
  });

  it("marca o pedido como sem taxa confirmada quando o escrow não veio", () => {
    const o = normalizeShopeeOrder(detail, null);

    expect(o.feesFromEscrow).toBe(false);
    expect(o.commissionAmount).toBe("0.0000");
    expect(o.marketplaceFeeAmount).toBe("0.0000");
    // Sem escrow, o frete do comprador cai para a estimativa do pedido em vez
    // de virar zero e inflar o resultado.
    expect(o.shippingChargedToBuyer).toBe("12.9000");
  });

  it("preserva o payload cru dos dois lados para poder recalcular depois", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    expect(o.raw).toEqual({ detail, escrow });
  });

  it("trata desconto ausente como preço cheio, não como item de graça", () => {
    const o = normalizeShopeeOrder(
      { ...detail, item_list: [{ ...detail.item_list[0]!, model_discounted_price: 0 }] },
      escrow,
    );
    expect(o.grossAmount).toBe("99.8000");
    expect(o.discountAmount).toBe("0.0000");
    expect(o.items[0]!.unitPrice).toBe("49.9000");
  });

  it("não rateia a taxa do pedido entre os itens", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    expect(o.items[0]!.commissionAmount).toBe("0");
    expect(o.items[0]!.feeAmount).toBe("0");
  });
});

describe("resolveShopeeSku — a chave que liga pedido a custo", () => {
  it("prefere o SKU da variação, que é onde o custo é cadastrado", () => {
    expect(resolveShopeeSku({ item_sku: "PAI", model_sku: "FILHO" })).toBe("FILHO");
  });

  it("cai para o SKU do anúncio quando não há variação", () => {
    expect(resolveShopeeSku({ item_sku: "PAI", model_sku: "   " })).toBe("PAI");
  });

  it("usa o item_id em último caso para não perder a linha do pedido", () => {
    expect(resolveShopeeSku({ item_id: 987 })).toBe("987");
  });
});

describe("normalizeShopeeStatus", () => {
  it.each([
    ["UNPAID", "CREATED"],
    ["READY_TO_SHIP", "PAID"],
    ["PROCESSED", "PAID"],
    ["SHIPPED", "SHIPPED"],
    ["COMPLETED", "DELIVERED"],
    ["CANCELLED", "CANCELED"],
    ["IN_CANCEL", "CANCELED"],
    ["TO_RETURN", "RETURNED"],
  ])("%s → %s", (shopee, expected) => {
    expect(normalizeShopeeStatus(shopee)).toBe(expected);
  });

  it("um status desconhecido não vira receita", () => {
    // DELIVERED por engano contaria como venda concluída; CREATED não conta.
    expect(normalizeShopeeStatus("ALGO_NOVO_DA_SHOPEE")).toBe("CREATED");
  });
});

describe("stripShopeePersonalData — o que não entra em conta não entra no banco", () => {
  it("remove endereço, nome e documento do comprador, em qualquer profundidade", () => {
    const o = normalizeShopeeOrder(
      {
        ...detail,
        // @ts-expect-error — campos que a Shopee devolve e o tipo não declara
        buyer_username: "fulano123",
        buyer_cpf_id: "000.000.000-00",
        recipient_address: { name: "Fulano de Tal", phone: "11999999999", full_address: "Rua X, 123" },
        note: "deixar com o vizinho",
      },
      escrow,
    );

    const serialized = JSON.stringify(o.raw);
    expect(serialized).not.toContain("fulano123");
    expect(serialized).not.toContain("Fulano de Tal");
    expect(serialized).not.toContain("11999999999");
    expect(serialized).not.toContain("Rua X");
    expect(serialized).not.toContain("vizinho");
  });

  it("preserva tudo que serve ao cálculo", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    const raw = o.raw as { detail: typeof detail; escrow: typeof escrow };

    expect(raw.escrow.order_income.commission_fee).toBe(8.5);
    expect(raw.escrow.order_income.actual_shipping_fee).toBe(21.4);
    expect(raw.detail.item_list[0]!.model_sku).toBe("LAVANDROLL-1-LAV");
    expect(raw.detail.item_list[0]!.model_original_price).toBe(49.9);
  });

  it("não confunde model_name com nome de pessoa", () => {
    const o = normalizeShopeeOrder(detail, escrow);
    expect(JSON.stringify(o.raw)).toContain("Lavanda");
  });
});
