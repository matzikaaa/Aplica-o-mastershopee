import { NextResponse } from "next/server";
import { prisma, recomputeMetricsForDays, type MarketplaceType } from "@mastershopee/database";
import { parseBrDate, parseBrNumber } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { ensureImportAccount } from "@/lib/import-account";

interface Body {
  marketplace?: MarketplaceType;
  campaignName?: string;
  from?: string;
  to?: string;
  spend?: string;
  attributedRevenue?: string;
  orders?: string;
}

/**
 * Manual ad spend entry, for marketplaces whose Ads API is not available and
 * whose export is a period total rather than a daily series.
 *
 * A single day is recorded as measured. A period is split evenly across its
 * days and every row is flagged `isEstimated`: the total the operator typed is
 * real, the per-day slice is arithmetic. Flagging it is the difference between
 * a rateio and a fabricated daily number (§75, §96) — a daily chart can then
 * say so instead of presenting it as measured.
 *
 * Idempotent on (campaign, day): re-sending an overlapping period corrects the
 * days it covers rather than stacking on top of them.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const body = (await request.json()) as Body;

  const marketplace = body.marketplace;
  const campaignName = body.campaignName?.trim();
  const from = parseBrDate(body.from);
  const to = parseBrDate(body.to ?? body.from);
  const spend = parseBrNumber(body.spend);

  const missing: string[] = [];
  if (!marketplace) missing.push("marketplace");
  if (!campaignName) missing.push("nome da campanha");
  if (!from) missing.push("data inicial");
  if (!to) missing.push("data final");
  if (spend === null) missing.push("valor gasto");
  if (missing.length > 0) {
    return NextResponse.json({ error: `Faltando: ${missing.join(", ")}.` }, { status: 400 });
  }

  const start = new Date(from!.getFullYear(), from!.getMonth(), from!.getDate());
  const end = new Date(to!.getFullYear(), to!.getMonth(), to!.getDate());
  if (end < start) {
    return NextResponse.json({ error: "A data final é anterior à inicial." }, { status: 400 });
  }
  if (spend! < 0) {
    return NextResponse.json({ error: "O gasto não pode ser negativo." }, { status: 400 });
  }

  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));

  const isEstimated = days.length > 1;
  const perDaySpend = spend! / days.length;
  const revenue = parseBrNumber(body.attributedRevenue) ?? 0;
  const orderCount = parseBrNumber(body.orders) ?? 0;

  const account = await ensureImportAccount(workspace.id, marketplace!);
  const externalCampaignId = `manual:${campaignName!.toLowerCase()}`;

  const campaign = await prisma.adCampaign.upsert({
    where: { marketplaceAccountId_externalCampaignId: { marketplaceAccountId: account.id, externalCampaignId } },
    update: { name: campaignName! },
    create: {
      workspaceId: workspace.id,
      marketplaceAccountId: account.id,
      marketplace: marketplace!,
      externalCampaignId,
      name: campaignName!,
      status: "MANUAL",
    },
  });

  for (const date of days) {
    await prisma.adSpend.upsert({
      where: { campaignId_date: { campaignId: campaign.id, date } },
      update: {
        spend: perDaySpend,
        attributedRevenue: revenue / days.length,
        orders: Math.round(orderCount / days.length),
        isEstimated,
      },
      create: {
        campaignId: campaign.id,
        date,
        spend: perDaySpend,
        attributedRevenue: revenue / days.length,
        orders: Math.round(orderCount / days.length),
        isEstimated,
      },
    });
  }

  const daysRecomputed = await recomputeMetricsForDays(
    workspace.id,
    days.map((d) => d.toISOString().slice(0, 10)),
  );

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "ads.manual_entry",
      metadata: { marketplace, campaignName, days: days.length, spend, isEstimated },
    },
  });

  return NextResponse.json({
    campaign: campaign.name,
    days: days.length,
    perDaySpend,
    isEstimated,
    daysRecomputed,
  });
}
