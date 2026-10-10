import { afterEach, describe, expect, it } from "vitest";
import { prisma, aplicarCustosAoHistorico, vendasSemCusto } from "@mastershopee/database";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

/**
 * "Aplicar ao histórico" contra Postgres real.
 *
 * O primeiro caso é a reprodução do defeito que deixou três vendas sem custo
 * sem conserto possível pela interface: o laço pulava o produto inteiro
 * quando o custo já começava antes da primeira venda, inclusive o
 * preenchimento.
 */
describe("aplicar custos ao histórico — Postgres real", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  async function vendaSemCusto(orderedAt: Date) {
    const { workspace, marketplaceAccount } = await createTestWorkspace("SHOPEE");
    workspaceId = workspace.id;
    const product = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "MataMofo-1", name: "Mata Mofo 1 un" },
    });
    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: "SHOPEE",
        externalOrderId: `SN-${orderedAt.getTime()}`,
        status: "DELIVERED",
        orderedAt,
        grossAmount: 30,
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        id: `${order.id}:MataMofo-1:`,
        orderId: order.id,
        productId: product.id,
        externalSku: "MataMofo-1",
        title: "Mata Mofo",
        quantity: 1,
        unitPrice: 30,
        unitCostSnapshot: null,
      },
    });
    return { workspace, product, item };
  }

  it("preenche quando o custo já começava antes da venda (o caso que ficava preso)", async () => {
    const venda = new Date("2026-05-20T12:00:00Z");
    const { workspace, product, item } = await vendaSemCusto(venda);

    // Custo cadastrado com data retroativa *depois* de o pedido já estar
    // gravado — por isso o item ficou sem snapshot, e o custo já é antigo o
    // bastante para não precisar ser retroagido.
    await prisma.productCost.create({
      data: { productId: product.id, unitCost: 13.46, effectiveFrom: new Date("2026-05-01T00:00:00Z") },
    });

    const r = await aplicarCustosAoHistorico(workspace.id);

    expect(r.backdated).toBe(0);
    expect(r.stillMissing).toBe(0);
    const depois = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(depois.unitCostSnapshot)).toBeCloseTo(13.46);
  });

  it("retroage o primeiro custo até a primeira venda e preenche", async () => {
    const venda = new Date("2026-05-20T12:00:00Z");
    const { workspace, product, item } = await vendaSemCusto(venda);
    await prisma.productCost.create({
      data: { productId: product.id, unitCost: 10, effectiveFrom: new Date("2026-09-01T00:00:00Z") },
    });

    const r = await aplicarCustosAoHistorico(workspace.id);

    expect(r.backdated).toBe(1);
    expect(r.stillMissing).toBe(0);
    const custo = await prisma.productCost.findFirstOrThrow({ where: { productId: product.id } });
    expect(custo.effectiveFrom.toISOString()).toBe(venda.toISOString());
    const depois = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(depois.unitCostSnapshot)).toBe(10);
  });

  it("não sobrescreve um custo que a venda já tinha", async () => {
    // Snapshot existente é o custo real daquele dia (§16). Reescrevê-lo com o
    // preço de hoje seria mudar o passado.
    const venda = new Date("2026-05-20T12:00:00Z");
    const { workspace, product, item } = await vendaSemCusto(venda);
    await prisma.orderItem.update({ where: { id: item.id }, data: { unitCostSnapshot: 9.5 } });
    await prisma.productCost.create({
      data: { productId: product.id, unitCost: 15, effectiveFrom: new Date("2026-09-01T00:00:00Z") },
    });

    await aplicarCustosAoHistorico(workspace.id);

    const depois = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(depois.unitCostSnapshot)).toBe(9.5);
  });

  it("a lista de vendas sem custo nomeia o SKU e o motivo", async () => {
    const venda = new Date("2026-05-20T12:00:00Z");
    const { workspace, product } = await vendaSemCusto(venda);
    await prisma.productCost.create({
      data: { productId: product.id, unitCost: 10, effectiveFrom: new Date("2026-09-01T00:00:00Z") },
    });

    const lista = await vendasSemCusto(workspace.id);

    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ sku: "MataMofo-1", itens: 1, motivo: "custo-comeca-depois-da-venda" });
  });
});
