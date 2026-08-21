import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";

/**
 * §22-23, §64: saves the WhatsApp destination number and daily-report time.
 * PENDING: actual message delivery requires WHATSAPP_ACCESS_TOKEN /
 * WHATSAPP_PHONE_NUMBER_ID (WhatsApp Business Platform Cloud API — see
 * .env.example). Until those are configured, this only persists
 * configuration; apps/worker's scheduler job checks `verified` before
 * attempting to send (see apps/worker/src/jobs/whatsapp-scheduler.ts).
 */
export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const gate = permissions.canUseWhatsApp();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const { phoneNumber, dailyReportTime, dailyReportEnabled } = await request.json();
  if (!phoneNumber || typeof phoneNumber !== "string") {
    return NextResponse.json({ error: "Número de telefone inválido." }, { status: 400 });
  }

  const existing = await prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } });

  // Changing the destination number invalidates the verification: what was
  // proven is that *that* number receives messages, and the proof does not
  // transfer to a different one.
  const numberChanged = existing !== null && existing.phoneNumber !== phoneNumber;

  const saved = await prisma.whatsappConfiguration.upsert({
    where: { workspaceId: workspace.id },
    update: {
      phoneNumber,
      dailyReportTime,
      dailyReportEnabled: Boolean(dailyReportEnabled),
      ...(numberChanged ? { verified: false } : {}),
    },
    create: { workspaceId: workspace.id, phoneNumber, dailyReportTime, dailyReportEnabled: Boolean(dailyReportEnabled) },
  });

  return NextResponse.json({ ok: true, verified: saved.verified, numberChanged });
}
