import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import {
  isWhatsappConfigured,
  sendWhatsappAlert,
  whatsappTemplates,
  WHATSAPP_NOT_CONFIGURED,
} from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";

/**
 * Sends a real message to the configured number and marks the configuration
 * verified only if Meta accepted it.
 *
 * This is the step that was missing: both the daily report and the low-stock
 * alert only run for `verified` configurations, and nothing ever set that
 * flag — so saving a number produced a setup that looked complete and never
 * sent anything. Verification here means "a message actually left", not "the
 * operator typed a number" (§96).
 *
 * On failure the flag is cleared and Meta's own error is stored and returned:
 * "template name does not exist", "24 hours have passed", "recipient not in
 * allowed list" each point at a different fix, and paraphrasing them would
 * throw that away.
 */
export async function POST() {
  const { workspace, user } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const gate = permissions.canUseWhatsApp();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const config = await prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } });
  if (!config?.phoneNumber) {
    return NextResponse.json({ error: "Salve o número do WhatsApp antes de testar." }, { status: 400 });
  }

  if (!isWhatsappConfigured()) {
    return NextResponse.json({ error: WHATSAPP_NOT_CONFIGURED }, { status: 400 });
  }

  const now = new Date().toLocaleString("pt-BR", { timeZone: workspace.timezone });
  const fallbackText = `Teste de conexão do Mastershopee para ${workspace.name}. Se você recebeu isto, os alertas estão funcionando. (${now})`;

  try {
    const { messageId, via } = await sendWhatsappAlert(
      config.phoneNumber,
      whatsappTemplates.dailyReport(),
      [workspace.name, "R$ 0,00", "R$ 0,00", "0,00%", "0", "R$ 0,00"],
      fallbackText,
    );

    await prisma.whatsappConfiguration.update({
      where: { workspaceId: workspace.id },
      data: { verified: true },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        action: "whatsapp.verified",
        metadata: { phoneNumber: config.phoneNumber, via, messageId },
      },
    });

    return NextResponse.json({ ok: true, via, messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao enviar a mensagem de teste.";

    // A number that used to work and now does not must stop being treated as
    // verified, or the scheduler keeps firing into a dead channel.
    await prisma.whatsappConfiguration.update({
      where: { workspaceId: workspace.id },
      data: { verified: false },
    });

    await prisma.integrationLog.create({
      data: { workspaceId: workspace.id, level: "error", message: `Teste de WhatsApp falhou: ${message}` },
    });

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
