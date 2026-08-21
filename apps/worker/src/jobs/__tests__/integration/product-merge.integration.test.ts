import { afterEach, describe, expect, it } from "vitest";
import { prisma, mergeProducts, recordStockMovement, resolveProductBySku } from "@mastershopee/database";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

/**
 * Merging a mistyped SKU into the real one. The case that produced this:
 * a Shopee catalogue carrying both "LAVANDROLL-1" and "LAVNDROLL-1" for the
 * same physical product, so four months of sales arrived split in two.
 */
describe("unificação de SKUs — Postgres real", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  async function setup() {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;

    const keep = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "LAVANDROLL-1", name: "Saco Lixo 10L Lavanda" },
    });
    const merge = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "LAVNDROLL-1", name: "Kit 1 Rolo Saco de Lixo" },
    });

    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: "MERCADO_LIVRE",
        externalOrderId: `ord-${Date.now()}`,
        status: "DELIVERED",
        orderedAt: new Date("2026-07-15"),
        grossAmount: 100,
      },
    });

    return { workspace, order, keep, merge };
  }

  it("move pedidos, custos e estoque para o SKU que fica", async () => {
    const { workspace, order, keep, merge } = await setup();

    await prisma.orderItem.create({
      data: { orderId: order.id, productId: keep.id, externalSku: keep.sku, title: keep.name, quantity: 3, unitPrice: 12 },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: merge.id, externalSku: merge.sku, title: merge.name, quantity: 2, unitPrice: 12 },
    });
    await prisma.productCost.create({
      data: { productId: merge.id, unitCost: 4, effectiveFrom: new Date("2026-05-01") },
    });
    await recordStockMovement({ workspaceId: workspace.id, productId: keep.id, type: "PURCHASE_IN", units: 40 });
    await recordStockMovement({ workspaceId: workspace.id, productId: merge.id, type: "PURCHASE_IN", units: 10 });

    const result = await mergeProducts({
      workspaceId: workspace.id,
      keepSku: "LAVANDROLL-1",
      mergeSku: "LAVNDROLL-1",
    });

    expect(result.orderItemsMoved).toBe(1);
    expect(result.costsMoved).toBe(1);
    expect(result.unitsTransferred).toBe(10);

    const items = await prisma.orderItem.count({ where: { productId: keep.id } });
    expect(items).toBe(2);

    const stock = await prisma.stockItem.findUnique({ where: { productId: keep.id } });
    expect(stock?.quantity).toBe(50);

    // Nothing was thrown away: both ledgers plus the seam that explains the jump.
    const movements = await prisma.stockMovement.count({ where: { stockItemId: stock!.id } });
    expect(movements).toBe(3);

    expect(await prisma.product.count({ where: { workspaceId: workspace.id, sku: "LAVNDROLL-1" } })).toBe(0);
  });

  it("o SKU que sumiu vira apelido e continua resolvendo para o produto certo", async () => {
    const { workspace } = await setup();

    await mergeProducts({ workspaceId: workspace.id, keepSku: "LAVANDROLL-1", mergeSku: "LAVNDROLL-1" });

    const resolved = await resolveProductBySku(workspace.id, "LAVNDROLL-1");
    expect(resolved?.sku).toBe("LAVANDROLL-1");
  });

  it("não deixa o estoque negativo virar positivo nem some com o saldo", async () => {
    const { workspace, keep, merge } = await setup();
    await recordStockMovement({ workspaceId: workspace.id, productId: keep.id, type: "PURCHASE_IN", units: 5 });
    await recordStockMovement({ workspaceId: workspace.id, productId: merge.id, type: "SALE_OUT", units: -8 });

    await mergeProducts({ workspaceId: workspace.id, keepSku: "LAVANDROLL-1", mergeSku: "LAVNDROLL-1" });

    const stock = await prisma.stockItem.findUnique({ where: { productId: keep.id } });
    expect(stock?.quantity).toBe(-3);
  });

  it("recusa unificar um SKU consigo mesmo", async () => {
    const { workspace } = await setup();
    await expect(
      mergeProducts({ workspaceId: workspace.id, keepSku: "LAVANDROLL-1", mergeSku: "LAVANDROLL-1" }),
    ).rejects.toThrow(/mesmo/);
  });

  it("recusa unificar um SKU que não existe, sem tocar no outro", async () => {
    const { workspace, keep } = await setup();
    await expect(
      mergeProducts({ workspaceId: workspace.id, keepSku: "LAVANDROLL-1", mergeSku: "NAO-EXISTE" }),
    ).rejects.toThrow(/não existe/);
    expect(await prisma.product.count({ where: { id: keep.id } })).toBe(1);
  });

  it("carrega junto os apelidos que o produto absorvido já tinha", async () => {
    const { workspace, merge } = await setup();
    await prisma.productSkuAlias.create({
      data: { workspaceId: workspace.id, productId: merge.id, sku: "LAVNDROL-1" },
    });

    const result = await mergeProducts({ workspaceId: workspace.id, keepSku: "LAVANDROLL-1", mergeSku: "LAVNDROLL-1" });

    expect(result.aliasesInherited).toEqual(["LAVNDROL-1"]);
    expect((await resolveProductBySku(workspace.id, "LAVNDROL-1"))?.sku).toBe("LAVANDROLL-1");
  });
});
