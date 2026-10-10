import { afterEach, describe, expect, it } from "vitest";
import {
  prisma,
  agruparEstoque,
  applySaleToStock,
  recordStockMovement,
  reverseSaleFromStock,
  unitsSoldPerProduct,
  collectLowStock,
  upsertNormalizedOrder,
  createSyncCache,
  pedidosJaCompletos,
} from "@mastershopee/database";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

/**
 * O agrupamento de estoque contra Postgres real.
 *
 * Escrito depois de o agrupamento ter ido ao ar sem teste nenhum de banco — e
 * de a revisão seguinte achar um caminho (entrada numa variação) em que a
 * mercadoria recebida sumia num saldo que ninguém lia. Estes testes fixam o
 * que precisa ser verdade para o número da prateleira ser confiável.
 */
describe("agrupamento de estoque — Postgres real", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  async function setup() {
    const { workspace, marketplaceAccount } = await createTestWorkspace("SHOPEE");
    workspaceId = workspace.id;
    const base = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "LAVANDROLL-1", name: "Rolo Lavanda — 1 un" },
    });
    const kit3 = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "LAVANDROLL-3", name: "Rolo Lavanda — 3 un" },
    });
    const kit10 = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "LAVANDROLL-10", name: "Rolo Lavanda — 10 un" },
    });
    return { workspace, marketplaceAccount, base, kit3, kit10 };
  }

  it("venda de uma variação desconta da base, multiplicada", async () => {
    const { workspace, base, kit3 } = await setup();
    await recordStockMovement({ workspaceId: workspace.id, productId: base.id, type: "PURCHASE_IN", units: 100 });
    await agruparEstoque(workspace.id, base.id, [{ productId: kit3.id, unitsPerSale: 3 }]);

    const saldo = await applySaleToStock({
      workspaceId: workspace.id,
      productId: kit3.id,
      orderItemId: "pedido-1:LAVANDROLL-3:",
      units: 2,
    });

    // Duas caixas de três: seis da prateleira.
    expect(saldo).toBe(94);
    const kitItem = await prisma.stockItem.findUnique({ where: { productId: kit3.id } });
    // A variação não ganha saldo próprio; a baixa nunca passa por ela.
    expect(kitItem?.quantity ?? 0).toBe(0);
  });

  it("agrupar transfere o saldo da variação para a base, em unidades-base", async () => {
    const { workspace, base, kit3 } = await setup();
    await recordStockMovement({ workspaceId: workspace.id, productId: base.id, type: "PURCHASE_IN", units: 10 });
    await recordStockMovement({ workspaceId: workspace.id, productId: kit3.id, type: "PURCHASE_IN", units: 5 });

    const r = await agruparEstoque(workspace.id, base.id, [{ productId: kit3.id, unitsPerSale: 3 }]);

    expect(r.unidadesTransferidas).toBe(15);
    const baseItem = await prisma.stockItem.findUniqueOrThrow({ where: { productId: base.id } });
    const kitItem = await prisma.stockItem.findUniqueOrThrow({ where: { productId: kit3.id } });
    expect(baseItem.quantity).toBe(25);
    expect(kitItem.quantity).toBe(0);

    // A transferência fica no extrato com a razão escrita, nos dois lados.
    const ajustes = await prisma.stockMovement.findMany({
      where: { workspaceId: workspace.id, type: "ADJUSTMENT" },
      orderBy: { quantity: "asc" },
    });
    expect(ajustes.map((a) => a.quantity)).toEqual([-5, 15]);
  });

  it("devolução devolve o que a venda tirou, mesmo se o multiplicador mudou depois", async () => {
    const { workspace, base, kit3 } = await setup();
    await recordStockMovement({ workspaceId: workspace.id, productId: base.id, type: "PURCHASE_IN", units: 50 });
    await agruparEstoque(workspace.id, base.id, [{ productId: kit3.id, unitsPerSale: 3 }]);

    await applySaleToStock({
      workspaceId: workspace.id,
      productId: kit3.id,
      orderItemId: "pedido-2:LAVANDROLL-3:",
      units: 1,
    });

    // Alguém corrige o cadastro entre a venda e a devolução.
    await prisma.product.update({ where: { id: kit3.id }, data: { unitsPerSale: 4 } });

    const saldo = await reverseSaleFromStock({
      workspaceId: workspace.id,
      productId: kit3.id,
      orderItemId: "pedido-2:LAVANDROLL-3:",
      units: 1,
      type: "RETURN_IN",
    });

    // Saiu 3, volta 3 — não 4. Recalcular pelo cadastro de hoje criaria uma
    // unidade que nunca existiu.
    expect(saldo).toBe(50);
  });

  it("revender o mesmo pedido não desconta duas vezes", async () => {
    const { workspace, base, kit10 } = await setup();
    await recordStockMovement({ workspaceId: workspace.id, productId: base.id, type: "PURCHASE_IN", units: 30 });
    await agruparEstoque(workspace.id, base.id, [{ productId: kit10.id, unitsPerSale: 10 }]);

    const venda = { workspaceId: workspace.id, productId: kit10.id, orderItemId: "pedido-3:LAVANDROLL-10:", units: 1 };
    expect(await applySaleToStock(venda)).toBe(20);
    expect(await applySaleToStock(venda)).toBeNull();

    const baseItem = await prisma.stockItem.findUniqueOrThrow({ where: { productId: base.id } });
    expect(baseItem.quantity).toBe(20);
  });

  it("ritmo de venda soma na base, em unidades-base", async () => {
    const { workspace, marketplaceAccount, base, kit3 } = await setup();
    await agruparEstoque(workspace.id, base.id, [{ productId: kit3.id, unitsPerSale: 3 }]);

    const pedido = (sn: string, sku: string, quantidade: number) => ({
      externalOrderId: sn,
      status: "PAID" as const,
      orderedAt: new Date(),
      currency: "BRL",
      grossAmount: "10",
      discountAmount: "0",
      shippingChargedToBuyer: "0",
      shippingSubsidizedByMerchant: "0",
      commissionAmount: "0",
      marketplaceFeeAmount: "0",
      taxAmount: "0",
      feesFromEscrow: true,
      raw: {},
      items: [
        {
          externalSku: sku,
          externalProductId: "1",
          title: sku,
          quantity: quantidade,
          unitPrice: "10",
          commissionAmount: "0",
          feeAmount: "0",
          taxAmount: "0",
        },
      ],
    });

    const cache = createSyncCache();
    await upsertNormalizedOrder(marketplaceAccount, pedido("P1", "LAVANDROLL-3", 2), cache);
    await upsertNormalizedOrder(marketplaceAccount, pedido("P2", "LAVANDROLL-1", 1), cache);

    const vendido = await unitsSoldPerProduct(workspace.id, 30);
    // 2 caixas de 3 + 1 avulso = 7 unidades da mesma prateleira. Somar
    // "2 + 1" daria 3 e a cobertura sairia pelo dobro do tempo real.
    expect(vendido.get(base.id)).toBe(7);
    expect(vendido.has(kit3.id)).toBe(false);
  });

  it("o alerta de reposição ignora as variações agrupadas", async () => {
    const { workspace, base, kit3 } = await setup();
    await agruparEstoque(workspace.id, base.id, [{ productId: kit3.id, unitsPerSale: 3 }]);
    await prisma.stockItem.upsert({
      where: { productId: kit3.id },
      update: {},
      create: { workspaceId: workspace.id, productId: kit3.id, quantity: 0, leadTimeDays: 5 },
    });

    const baixos = await collectLowStock(workspace.id);
    expect(baixos.map((b) => b.sku)).not.toContain("LAVANDROLL-3");
  });

  it("recusa base que já pertence a outro grupo", async () => {
    const { workspace, base, kit3, kit10 } = await setup();
    await agruparEstoque(workspace.id, base.id, [{ productId: kit3.id, unitsPerSale: 3 }]);

    // Encadear grupos faria a baixa subir vários saltos, e um ciclo acidental
    // travaria toda gravação de venda.
    await expect(
      agruparEstoque(workspace.id, kit3.id, [{ productId: kit10.id, unitsPerSale: 10 }]),
    ).rejects.toThrow(/outro grupo/);
  });

  it("não agrupa produto de outro workspace", async () => {
    const { workspace, base } = await setup();
    const outro = await createTestWorkspace("SHOPEE");
    try {
      const alheio = await prisma.product.create({
        data: { workspaceId: outro.workspace.id, sku: "ALHEIO-3", name: "De outro cliente" },
      });

      const r = await agruparEstoque(workspace.id, base.id, [{ productId: alheio.id, unitsPerSale: 3 }]);

      expect(r.agrupados).toBe(0);
      const intocado = await prisma.product.findUniqueOrThrow({ where: { id: alheio.id } });
      expect(intocado.stockParentId).toBeNull();
    } finally {
      await cleanupTestWorkspace(outro.workspace.id);
    }
  });
});

describe("pedidos já completos — Postgres real", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  async function pedidoGravado(status: "DELIVERED" | "RETURNED", feesAreEstimated: boolean) {
    const { workspace, marketplaceAccount } = await createTestWorkspace("SHOPEE");
    workspaceId = workspace.id;
    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: "SHOPEE",
        externalOrderId: "SN-1",
        status,
        orderedAt: new Date(),
        grossAmount: 100,
        feesAreEstimated,
      },
    });
    await prisma.orderItem.create({
      data: {
        id: `${order.id}:SKU:`,
        orderId: order.id,
        externalSku: "SKU",
        title: "Produto",
        quantity: 1,
        unitPrice: 100,
      },
    });
    return marketplaceAccount;
  }

  it("pula o pedido com taxa confirmada e status inalterado", async () => {
    const conta = await pedidoGravado("DELIVERED", false);
    const r = await pedidosJaCompletos(conta.id, ["SN-1"], { statusListado: new Map([["SN-1", "DELIVERED"]]) });
    expect(r.has("SN-1")).toBe(true);
  });

  it("relê o pedido entregue que virou devolução depois do repasse", async () => {
    // O caso que o filtro antigo perdia: taxa confirmada, itens gravados —
    // "completo" — e mesmo assim mudou. Pular aqui deixaria a receita contada
    // e o estoque sem voltar.
    const conta = await pedidoGravado("DELIVERED", false);
    const r = await pedidosJaCompletos(conta.id, ["SN-1"], { statusListado: new Map([["SN-1", "RETURNED"]]) });
    expect(r.has("SN-1")).toBe(false);
  });

  it("relê o pedido com taxa ainda estimada", async () => {
    const conta = await pedidoGravado("DELIVERED", true);
    const r = await pedidosJaCompletos(conta.id, ["SN-1"], { statusListado: new Map([["SN-1", "DELIVERED"]]) });
    expect(r.has("SN-1")).toBe(false);
  });

  it("sem status na listagem, a sincronização incremental relê", async () => {
    const conta = await pedidoGravado("DELIVERED", false);
    expect((await pedidosJaCompletos(conta.id, ["SN-1"], { semStatusPula: false })).has("SN-1")).toBe(false);
    expect((await pedidosJaCompletos(conta.id, ["SN-1"], { semStatusPula: true })).has("SN-1")).toBe(true);
  });
});
