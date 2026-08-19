import { afterEach, describe, expect, it } from "vitest";
import {
  prisma,
  applySaleToStock,
  recordStockMovement,
  reverseSaleFromStock,
  unitsSoldPerProduct,
} from "@mastershopee/database";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

describe("stock ledger — real Postgres", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  async function setup(startingUnits = 0) {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;
    const product = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "SKU-STOCK", name: "Saco de Lixo 100L" },
    });
    if (startingUnits > 0) {
      await recordStockMovement({
        workspaceId: workspace.id,
        productId: product.id,
        type: "PURCHASE_IN",
        units: startingUnits,
        note: "Carga inicial",
      });
    }
    return { workspace, marketplaceAccount, product };
  }

  it("desconta as unidades vendidas do saldo", async () => {
    const { workspace, product } = await setup(50);

    const balance = await applySaleToStock({
      workspaceId: workspace.id,
      productId: product.id,
      orderItemId: "order-1:SKU-STOCK:",
      units: 3,
    });

    expect(balance).toBe(47);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { productId: product.id } });
    expect(item.quantity).toBe(47);
  });

  it("nunca desconta duas vezes o mesmo item de pedido, mesmo com sync repetido", async () => {
    const { workspace, product } = await setup(50);
    const orderItemId = "order-2:SKU-STOCK:";

    const first = await applySaleToStock({ workspaceId: workspace.id, productId: product.id, orderItemId, units: 3 });
    // O sync do marketplace relê os mesmos pedidos a cada execução.
    const second = await applySaleToStock({ workspaceId: workspace.id, productId: product.id, orderItemId, units: 3 });
    const third = await applySaleToStock({ workspaceId: workspace.id, productId: product.id, orderItemId, units: 3 });

    expect(first).toBe(47);
    expect(second).toBeNull();
    expect(third).toBeNull();

    const item = await prisma.stockItem.findUniqueOrThrow({ where: { productId: product.id } });
    expect(item.quantity).toBe(47);

    const movements = await prisma.stockMovement.findMany({ where: { stockItemId: item.id, type: "SALE_OUT" } });
    expect(movements).toHaveLength(1);
  });

  it("registra o saldo resultante em cada movimento do histórico", async () => {
    const { workspace, product } = await setup(10);
    await applySaleToStock({ workspaceId: workspace.id, productId: product.id, orderItemId: "o3:s:", units: 4 });

    const item = await prisma.stockItem.findUniqueOrThrow({ where: { productId: product.id } });
    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId: item.id },
      orderBy: { createdAt: "asc" },
    });

    expect(movements.map((m) => [m.type, m.quantity, m.balanceAfter])).toEqual([
      ["PURCHASE_IN", 10, 10],
      ["SALE_OUT", -4, 6],
    ]);
  });

  it("devolve as unidades quando a venda é cancelada — e só uma vez", async () => {
    const { workspace, product } = await setup(20);
    const orderItemId = "order-4:SKU-STOCK:";
    await applySaleToStock({ workspaceId: workspace.id, productId: product.id, orderItemId, units: 5 });

    const back = await reverseSaleFromStock({
      workspaceId: workspace.id,
      productId: product.id,
      orderItemId,
      units: 5,
      type: "CANCELLATION_IN",
    });
    const again = await reverseSaleFromStock({
      workspaceId: workspace.id,
      productId: product.id,
      orderItemId,
      units: 5,
      type: "CANCELLATION_IN",
    });

    expect(back).toBe(20);
    expect(again).toBeNull();
  });

  it("não credita estoque de um pedido que nunca deu baixa", async () => {
    const { workspace, product } = await setup(20);

    // Pedido que já chegou cancelado na primeira sincronização.
    const result = await reverseSaleFromStock({
      workspaceId: workspace.id,
      productId: product.id,
      orderItemId: "order-nunca-vendido:SKU-STOCK:",
      units: 5,
      type: "CANCELLATION_IN",
    });

    expect(result).toBeNull();
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { productId: product.id } });
    expect(item.quantity).toBe(20);
  });

  it("permite saldo negativo em vez de mascarar venda de item não registrado", async () => {
    const { workspace, product } = await setup(2);

    const balance = await applySaleToStock({
      workspaceId: workspace.id,
      productId: product.id,
      orderItemId: "order-5:SKU-STOCK:",
      units: 5,
    });

    expect(balance).toBe(-3);
  });

  it("entrada de mercadoria limpa o marcador de alerta já enviado", async () => {
    const { workspace, product } = await setup(1);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { productId: product.id } });
    await prisma.stockItem.update({ where: { id: item.id }, data: { lowStockNotifiedAt: new Date() } });

    await recordStockMovement({
      workspaceId: workspace.id,
      productId: product.id,
      type: "PURCHASE_IN",
      units: 100,
      note: "Chegou carga do fornecedor",
    });

    const after = await prisma.stockItem.findUniqueOrThrow({ where: { productId: product.id } });
    expect(after.quantity).toBe(101);
    expect(after.lowStockNotifiedAt).toBeNull();
  });

  it("unitsSoldPerProduct ignora pedidos cancelados", async () => {
    const { workspace, marketplaceAccount, product } = await setup(100);

    async function makeOrder(externalOrderId: string, status: "PAID" | "CANCELED", qty: number) {
      const order = await prisma.order.create({
        data: {
          workspaceId: workspace.id,
          marketplaceAccountId: marketplaceAccount.id,
          marketplace: marketplaceAccount.marketplace,
          externalOrderId,
          status,
          orderedAt: new Date(),
          grossAmount: "10.00",
        },
      });
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          externalSku: "SKU-STOCK",
          title: "Saco de Lixo 100L",
          quantity: qty,
          unitPrice: "10.00",
        },
      });
    }

    await makeOrder("ok-1", "PAID", 6);
    await makeOrder("cancelado-1", "CANCELED", 50);

    const sold = await unitsSoldPerProduct(workspace.id, 30);
    expect(sold.get(product.id)).toBe(6);
  });
});
