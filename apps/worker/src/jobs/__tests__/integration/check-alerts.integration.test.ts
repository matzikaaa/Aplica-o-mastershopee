import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@mastershopee/database";
import { runAlertChecks } from "../../check-alerts.js";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

function yesterdayMidnight(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe("runAlertChecks — real Postgres (§24-25)", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  it("fires a NET_MARGIN_BELOW alert (+ notification) when yesterday's margin crossed the configured threshold", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "NET_MARGIN_BELOW", config: { minMarginPercent: 20 }, channels: ["in_app"] },
    });
    await prisma.dailyMetric.create({
      data: {
        workspaceId: workspace.id,
        date: yesterdayMidnight(),
        grossRevenue: "1000.00",
        netProfit: "50.00", // 5% margin — below the 20% threshold
        orderCount: 3,
      },
    });

    await runAlertChecks();

    const events = await prisma.alertEvent.findMany({ where: { workspaceId: workspace.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe("IMPORTANT");

    const notifications = await prisma.notification.findMany({ where: { workspaceId: workspace.id } });
    expect(notifications).toHaveLength(1);
  });

  it("does not fire when the margin is above the threshold", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "NET_MARGIN_BELOW", config: { minMarginPercent: 10 }, channels: ["in_app"] },
    });
    await prisma.dailyMetric.create({
      data: { workspaceId: workspace.id, date: yesterdayMidnight(), grossRevenue: "1000.00", netProfit: "300.00", orderCount: 3 },
    });

    await runAlertChecks();

    const events = await prisma.alertEvent.findMany({ where: { workspaceId: workspace.id } });
    expect(events).toHaveLength(0);
  });

  it("does not re-fire the same alert twice on the same day (dedupe)", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "NET_MARGIN_BELOW", config: { minMarginPercent: 20 }, channels: ["in_app"] },
    });
    await prisma.dailyMetric.create({
      data: { workspaceId: workspace.id, date: yesterdayMidnight(), grossRevenue: "1000.00", netProfit: "50.00", orderCount: 3 },
    });

    await runAlertChecks(); // e.g. the 15-minute scheduler firing once
    await runAlertChecks(); // ...and again 15 minutes later, same underlying metric

    const events = await prisma.alertEvent.findMany({ where: { workspaceId: workspace.id } });
    expect(events).toHaveLength(1);
  });

  it("fires one NEGATIVE_MARGIN_PRODUCT alert per loss-making product", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    const product = await prisma.product.create({ data: { workspaceId: workspace.id, sku: "SKU-LOSS", name: "Produto no Prejuízo" } });
    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "NEGATIVE_MARGIN_PRODUCT", config: {}, channels: ["in_app"] },
    });
    await prisma.productMetric.create({
      data: {
        workspaceId: workspace.id,
        productId: product.id,
        date: yesterdayMidnight(),
        unitsSold: 5,
        revenue: "100.00",
        cost: "80.00",
        fees: "30.00",
        netProfit: "-10.00",
        margin: "-10.00",
      },
    });

    await runAlertChecks();

    const events = await prisma.alertEvent.findMany({ where: { workspaceId: workspace.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe("CRITICAL");
    expect(events[0]!.title).toContain("Produto no Prejuízo");
  });
});
