import { NextResponse } from "next/server";
import { prisma, type MarketplaceType } from "@mastershopee/database";
import { parseBrDate, parseBrNumber, type ImportSummary } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { ensureImportAccount } from "@/lib/import-account";

interface Row {
  date?: string;
  campaignName?: string;
  spend?: string;
  attributedRevenue?: string;
  orders?: string;
  clicks?: string;
  impressions?: string;
}

/**
 * Ad spend import from a marketplace's ads report.
 *
 * Idempotent on (campaign, date) — the same unique constraint the Ads API
 * path would use — so re-importing an overlapping period corrects the days
 * it covers instead of adding spend on top of itself.
 *
 * The campaign name doubles as its external id: manual exports rarely carry
 * a stable campaign id, and the name is what the operator recognises.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { rows, marketplace } = (await request.json()) as { rows: Row[]; marketplace: MarketplaceType };

  if (!marketplace) {
    return NextResponse.json({ error: "Informe o marketplace de origem." }, { status: 400 });
  }

  const account = await ensureImportAccount(workspace.id, marketplace);
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 2;
    const date = parseBrDate(row.date);
    const campaignName = row.campaignName?.trim();
    const spend = parseBrNumber(row.spend);

    const missing: string[] = [];
    if (!date) missing.push("data válida");
    if (!campaignName) missing.push("campanha");
    if (spend === null) missing.push("gasto");

    if (missing.length > 0) {
      summary.skipped++;
      summary.errors.push({ row: line, reference: campaignName, message: `Faltando: ${missing.join(", ")}.` });
      continue;
    }

    try {
      const campaign = await prisma.adCampaign.upsert({
        where: {
          marketplaceAccountId_externalCampaignId: {
            marketplaceAccountId: account.id,
            externalCampaignId: campaignName!,
          },
        },
        update: { name: campaignName! },
        create: {
          workspaceId: workspace.id,
          marketplaceAccountId: account.id,
          marketplace,
          externalCampaignId: campaignName!,
          name: campaignName!,
          status: "imported",
        },
      });

      // Normalize to midnight so one calendar day is one row.
      const day = new Date(date!.getFullYear(), date!.getMonth(), date!.getDate());

      const existing = await prisma.adSpend.findUnique({
        where: { campaignId_date: { campaignId: campaign.id, date: day } },
      });

      await prisma.adSpend.upsert({
        where: { campaignId_date: { campaignId: campaign.id, date: day } },
        update: {
          spend: spend!,
          attributedRevenue: parseBrNumber(row.attributedRevenue) ?? 0,
          orders: Math.trunc(parseBrNumber(row.orders) ?? 0),
          clicks: parseBrNumber(row.clicks) !== null ? Math.trunc(parseBrNumber(row.clicks)!) : null,
          impressions: parseBrNumber(row.impressions) !== null ? Math.trunc(parseBrNumber(row.impressions)!) : null,
        },
        create: {
          campaignId: campaign.id,
          date: day,
          spend: spend!,
          attributedRevenue: parseBrNumber(row.attributedRevenue) ?? 0,
          orders: Math.trunc(parseBrNumber(row.orders) ?? 0),
          clicks: parseBrNumber(row.clicks) !== null ? Math.trunc(parseBrNumber(row.clicks)!) : null,
          impressions: parseBrNumber(row.impressions) !== null ? Math.trunc(parseBrNumber(row.impressions)!) : null,
        },
      });

      existing ? summary.updated++ : summary.created++;
    } catch (err) {
      summary.errors.push({
        row: line,
        reference: campaignName,
        message: err instanceof Error ? err.message : "Falha ao gravar a linha.",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "import.ads",
      metadata: { marketplace, created: summary.created, updated: summary.updated, errors: summary.errors.length },
    },
  });

  return NextResponse.json(summary);
}
