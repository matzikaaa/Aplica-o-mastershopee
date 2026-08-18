import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@mastershopee/database";
import { computeDailyMetrics } from "../../compute-daily-metrics.js";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

describe("computeDailyMetrics — real Postgres (§54, §61)", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  it("aggregates real orders into DailyMetric/ProductMetric with correct Decimal math, and flags missing cost data", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;

    const product = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "SKU-1", name: "Produto Sem Custo" },
    });
    // deliberately no ProductCost row — this is what should flip dataQuality to "partial"

    const date = "2026-03-10";
    const orderedAt = new Date(`${date}T12:00:00`);

    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: marketplaceAccount.marketplace,
        externalOrderId: "order-1",
        status: "PAID",
        orderedAt,
        grossAmount: "100.00",
        commissionAmount: "10.00",
        marketplaceFeeAmount: "5.00",
        taxAmount: "2.00",
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        externalSku: "SKU-1",
        title: "Produto Sem Custo",
        quantity: 1,
        unitPrice: "100.00",
        commissionAmount: "10.00",
        feeAmount: "5.00",
      },
    });

    await computeDailyMetrics({ workspaceId: workspace.id, date });

    const metric = await prisma.dailyMetric.findUnique({
      where: { workspaceId_date: { workspaceId: workspace.id, date: new Date(`${date}T00:00:00`) } },
    });
    expect(metric).not.toBeNull();
    expect(metric!.grossRevenue.toString()).toBe("100");
    // 100 - 10 (commission) - 5 (fee) - 2 (tax) - 0 (cost, none on record) = 83
    expect(metric!.netProfit.toString()).toBe("83");
    expect(metric!.orderCount).toBe(1);
    expect(metric!.dataQuality).toBe("partial"); // product has zero cost history

    const productMetric = await prisma.productMetric.findUnique({
      where: { workspaceId_productId_date: { workspaceId: workspace.id, productId: product.id, date: new Date(`${date}T00:00:00`) } },
    });
    expect(productMetric).not.toBeNull();
    expect(productMetric!.unitsSold).toBe(1);
    expect(productMetric!.dataQuality).toBe("partial");
  });

  it("is idempotent — re-running the same workspace-day upserts in place instead of duplicating rows", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;

    const date = "2026-03-11";
    await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: marketplaceAccount.marketplace,
        externalOrderId: "order-2",
        status: "PAID",
        orderedAt: new Date(`${date}T09:00:00`),
        grossAmount: "50.00",
      },
    });

    await computeDailyMetrics({ workspaceId: workspace.id, date });
    await computeDailyMetrics({ workspaceId: workspace.id, date }); // simulates a late-arriving refund triggering recompute

    const rows = await prisma.dailyMetric.findMany({ where: { workspaceId: workspace.id, date: new Date(`${date}T00:00:00`) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grossRevenue.toString()).toBe("50");
  });

  it("marks the day dataQuality 'complete' when every sold product has cost history", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;

    const product = await prisma.product.create({
      data: { workspaceId: workspace.id, sku: "SKU-2", name: "Produto Com Custo" },
    });
    await prisma.productCost.create({
      data: { productId: product.id, unitCost: "20.00", effectiveFrom: new Date("2026-01-01") },
    });

    const date = "2026-03-12";
    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: marketplaceAccount.marketplace,
        externalOrderId: "order-3",
        status: "PAID",
        orderedAt: new Date(`${date}T15:00:00`),
        grossAmount: "60.00",
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        externalSku: "SKU-2",
        title: "Produto Com Custo",
        quantity: 1,
        unitPrice: "60.00",
      },
    });

    await computeDailyMetrics({ workspaceId: workspace.id, date });

    const metric = await prisma.dailyMetric.findUnique({
      where: { workspaceId_date: { workspaceId: workspace.id, date: new Date(`${date}T00:00:00`) } },
    });
    expect(metric!.dataQuality).toBe("complete");
  });
});
