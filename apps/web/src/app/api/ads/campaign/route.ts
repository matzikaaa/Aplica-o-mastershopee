import { NextResponse } from "next/server";
import { prisma, recomputeMetricsForDays } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/**
 * Remove a campaign and every day of spend under it.
 *
 * Manual entries are the operator's own bookkeeping, and a typo in a period or
 * a total has to be undoable — otherwise the only way out is a wrong number
 * living in the profit forever. The days it covered are re-aggregated so the
 * dashboard stops counting the spend immediately.
 *
 * Scoped to the caller's workspace (§8): the id alone is never trusted.
 */
export async function DELETE(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { campaignId } = (await request.json()) as { campaignId?: string };

  if (!campaignId) {
    return NextResponse.json({ error: "Informe a campanha." }, { status: 400 });
  }

  const campaign = await prisma.adCampaign.findFirst({
    where: { id: campaignId, workspaceId: workspace.id },
    include: { spend: { select: { date: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  }

  const days = campaign.spend.map((s) => s.date.toISOString().slice(0, 10));

  // AdSpend cascades from AdCampaign (see schema.prisma).
  await prisma.adCampaign.delete({ where: { id: campaign.id } });

  const daysRecomputed = await recomputeMetricsForDays(workspace.id, days);

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "ads.campaign_deleted",
      metadata: { name: campaign.name, marketplace: campaign.marketplace, days: days.length },
    },
  });

  return NextResponse.json({ name: campaign.name, days: days.length, daysRecomputed });
}
