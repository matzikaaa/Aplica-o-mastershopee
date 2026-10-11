import { afterEach, describe, expect, it } from "vitest";
import {
  backfillMissingCostSnapshots,
  calcularPedido,
  computeDailyMetrics,
  prisma,
  recalcularMetricasPendentes,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

/**
 * Embalagem, custo operacional, outros custos e imposto cadastrados em Custos
 * só ficavam no cadastro: o item do pedido congelava o custo unitário e mais
 * nada, e o lucro saía maior que o real para todo vendedor que os preenchia.
 */
describe("custos além do unitário — real Postgres", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  async function cenario() {
    const { workspace, marketplaceAccount } = await createTestWorkspace("SHOPEE");
    workspaceId = workspace.id;
    const product = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "CANECA", name: "Caneca" },
    });
    return { workspace, marketplaceAccount, product };
  }

  const pedido = (orderedAt: Date) => ({
    externalOrderId: `P-${orderedAt.getTime()}`,
    status: "PAID",
    orderedAt,
    currency: "BRL",
    grossAmount: "100.00",
    discountAmount: "0",
    shippingChargedToBuyer: "0",
    shippingSubsidizedByMerchant: "0",
    commissionAmount: "10.00",
    marketplaceFeeAmount: "5.00",
    taxAmount: "0",
    feesFromEscrow: true,
    items: [
      {
        externalSku: "CANECA",
        title: "Caneca",
        quantity: 2,
        unitPrice: "50.00",
        commissionAmount: "10.00",
        feeAmount: "5.00",
        taxAmount: "0",
      },
    ],
  });

  it("a venda sincronizada congela o custo inteiro e o lucro desconta embalagem, operacional, outros e imposto", async () => {
    const { workspace, marketplaceAccount, product } = await cenario();
    await prisma.productCost.create({
      data: {
        productId: product.id,
        unitCost: "20.00",
        packagingCost: "1.50",
        operationalCost: "0.50",
        otherCosts: "1.00",
        taxPercent: "6",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });

    await upsertNormalizedOrder(
      { id: marketplaceAccount.id, workspaceId: workspace.id, marketplace: "SHOPEE" },
      pedido(new Date("2026-03-10T12:00:00Z")) as never,
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { items: true, refunds: true },
    });
    const item = order.items[0]!;
    expect(item.unitCostSnapshot?.toString()).toBe("20");
    expect(item.packagingCostSnapshot?.toString()).toBe("1.5");
    expect(item.taxPercentSnapshot?.toString()).toBe("6");

    // 100 − 10 comissão − 5 taxa − 2×20 produto − 2×1,50 embalagem − 2×0,50
    // operacional − 2×1 outros − 6% de 100 imposto = 33
    const r = calcularPedido(order);
    expect(r.netProfit.toFixed()).toBe("33.00");
    expect(r.packaging.toFixed()).toBe("3.00");
    expect(r.taxes.toFixed()).toBe("6.00");

    await computeDailyMetrics({ workspaceId: workspace.id, date: "2026-03-10" });
    const metric = await prisma.dailyMetric.findUniqueOrThrow({
      where: { workspaceId_date: { workspaceId: workspace.id, date: new Date("2026-03-10T00:00:00") } },
    });
    expect(Number(metric.netProfit)).toBe(33);
    expect(Number(metric.taxes)).toBe(6);

    const porProduto = await prisma.productMetric.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(Number(porProduto.netProfit)).toBe(33);
  });

  it("cadastrar o custo depois da venda preenche também embalagem e imposto", async () => {
    const { workspace, marketplaceAccount, product } = await cenario();

    await upsertNormalizedOrder(
      { id: marketplaceAccount.id, workspaceId: workspace.id, marketplace: "SHOPEE" },
      pedido(new Date("2026-03-10T12:00:00Z")) as never,
    );
    await prisma.productCost.create({
      data: {
        productId: product.id,
        unitCost: "20.00",
        packagingCost: "1.50",
        taxPercent: "4",
        effectiveFrom: new Date("2026-03-01T00:00:00Z"),
      },
    });

    const dias = await backfillMissingCostSnapshots(product.id);
    expect(dias).toEqual(["2026-03-10"]);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } });
    expect(item.unitCostSnapshot?.toString()).toBe("20");
    expect(item.packagingCostSnapshot?.toString()).toBe("1.5");
    expect(item.taxPercentSnapshot?.toString()).toBe("4");
  });

  it("o recálculo em fatias refaz os dias com pedido e limpa a marca no fim", async () => {
    const { workspace, marketplaceAccount, product } = await cenario();
    await prisma.productCost.create({
      data: {
        productId: product.id,
        unitCost: "20.00",
        packagingCost: "2.00",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    for (const dia of ["2026-03-10", "2026-03-12"]) {
      await upsertNormalizedOrder(
        { id: marketplaceAccount.id, workspaceId: workspace.id, marketplace: "SHOPEE" },
        pedido(new Date(`${dia}T12:00:00Z`)) as never,
      );
    }
    // Métrica velha, como as gravadas antes de a embalagem entrar no cálculo.
    await prisma.dailyMetric.create({
      data: { workspaceId: workspace.id, date: new Date("2026-03-10T00:00:00"), grossRevenue: "100", netProfit: "45" },
    });
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { metricsRecomputeFrom: new Date("2026-03-01T00:00:00Z") },
    });

    // Prazo zero: não faz nada, mas guarda de onde continuar.
    const parado = await recalcularMetricasPendentes(workspace.id, -1);
    expect(parado).toEqual({ dias: 0, terminou: false });

    const r = await recalcularMetricasPendentes(workspace.id, 30_000);
    expect(r).toEqual({ dias: 2, terminou: true });

    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(ws.metricsRecomputeFrom).toBeNull();
    const metric = await prisma.dailyMetric.findUniqueOrThrow({
      where: { workspaceId_date: { workspaceId: workspace.id, date: new Date("2026-03-10T00:00:00") } },
    });
    // 100 − 10 − 5 − 2×20 − 2×2 = 41, não os 45 de antes.
    expect(Number(metric.netProfit)).toBe(41);
  });
});
