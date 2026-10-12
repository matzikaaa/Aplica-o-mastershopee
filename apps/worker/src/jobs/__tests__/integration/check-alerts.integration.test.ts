import { afterEach, describe, expect, it } from "vitest";
import { prisma, runAlertChecks } from "@mastershopee/database";
import { chaveDoDia, dataDoDia, somarDias } from "@mastershopee/shared";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

// "Ontem" no fuso do workspace de teste (America/Sao_Paulo), como o
// verificador calcula — no relógio do servidor, entre 0h e 3h UTC seria
// outro dia.
function yesterdayMidnight(): Date {
  return dataDoDia(somarDias(chaveDoDia(new Date(), "America/Sao_Paulo"), -1));
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
      data: { workspaceId: workspace.id, type: "NEGATIVE_MARGIN_PRODUCT", severity: "CRITICAL", config: {}, channels: ["in_app"] },
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

  // A tela de Alertas grava o limite em `threshold`. O verificador lia só
  // `minMarginPercent`, comparava a margem com undefined e nunca disparava.
  it("fires NET_MARGIN_BELOW for a rule saved the way the alerts screen saves it (config.threshold)", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "NET_MARGIN_BELOW", config: { threshold: 20 }, channels: ["in_app"] },
    });
    await prisma.dailyMetric.create({
      data: { workspaceId: workspace.id, date: yesterdayMidnight(), grossRevenue: "1000.00", netProfit: "50.00", orderCount: 3 },
    });

    await runAlertChecks();

    const events = await prisma.alertEvent.findMany({ where: { workspaceId: workspace.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toBe("Margem de ontem: 5,0% (limite: 20,0%).");
  });

  it("uses the severity the seller chose for the rule, and writes money the way the seller reads it", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "AD_SPEND_THRESHOLD", severity: "INFORMATIVE", config: { threshold: 500 }, channels: ["in_app"] },
    });
    await prisma.dailyMetric.create({
      data: { workspaceId: workspace.id, date: yesterdayMidnight(), grossRevenue: "3000.00", netProfit: "300.00", adSpend: "1234.50", orderCount: 9 },
    });

    await runAlertChecks();

    const events = await prisma.alertEvent.findMany({ where: { workspaceId: workspace.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe("INFORMATIVE");
    expect(events[0]!.message).toMatch(/^ADS de ontem: R\$\s1\.234,50 \(limite: R\$\s500,00\)\.$/);
  });

  it("skips a rule with no usable threshold instead of comparing against nothing", async () => {
    const { workspace } = await createTestWorkspace();
    workspaceId = workspace.id;

    await prisma.alertRule.create({
      data: { workspaceId: workspace.id, type: "DAILY_REVENUE_ABOVE", config: {}, channels: ["in_app"] },
    });
    await prisma.dailyMetric.create({
      data: { workspaceId: workspace.id, date: yesterdayMidnight(), grossRevenue: "1000.00", netProfit: "100.00", orderCount: 3 },
    });

    await runAlertChecks();

    expect(await prisma.alertEvent.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });
});
