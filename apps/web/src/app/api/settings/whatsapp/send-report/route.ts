import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import {
  isWhatsappConfigured,
  sendWhatsappAlert,
  whatsappTemplates,
  WHATSAPP_NOT_CONFIGURED,
} from "@mastershopee/integrations";
import { buildDailySummaryMessage, dailyReportParams, zonedTime } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";

/**
 * Envia o relatório diário agora, com os números reais.
 *
 * O teste de conexão que já existia manda zeros de propósito: ele prova que a
 * mensagem sai, não que o conteúdo está certo. Para conferir o relatório em
 * si é preciso enviá-lo de verdade — e o agendador que faria isso vive no
 * worker, que não está hospedado.
 *
 * Usa o mesmo compositor do agendamento (`@mastershopee/shared`), então o que
 * chega aqui é literalmente o que chegaria às 8h. Um "preview" com texto
 * próprio provaria a coisa errada.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();

  const permissions = await getPlanPermissionService(workspace.id);
  const gate = permissions.canUseWhatsApp();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const config = await prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } });
  if (!config?.phoneNumber) {
    return NextResponse.json({ error: "Salve o número do WhatsApp antes de enviar." }, { status: 400 });
  }
  if (!isWhatsappConfigured()) {
    return NextResponse.json({ error: WHATSAPP_NOT_CONFIGURED }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { date?: string };

  // O dia é o do vendedor, não o do servidor: um relatório "de ontem" gerado
  // em UTC manda o dia errado para quem está em São Paulo depois das 21h.
  const hoje = zonedTime(workspace.timezone);
  hoje.setHours(0, 0, 0, 0);
  const alvo = body.date ? new Date(`${body.date}T00:00:00`) : new Date(hoje.getTime() - 24 * 3600 * 1000);

  const metric = await prisma.dailyMetric.findUnique({
    where: { workspaceId_date: { workspaceId: workspace.id, date: alvo } },
  });

  if (!metric) {
    // Sem métrica não há relatório. Mandar zeros aqui seria dizer que o dia
    // fechou sem vendas, que é diferente de não haver dado sobre o dia.
    return NextResponse.json(
      {
        error: `Ainda não há dados fechados para ${alvo.toLocaleDateString("pt-BR")}. Importe os pedidos primeiro, ou escolha outra data.`,
      },
      { status: 409 },
    );
  }

  const periodo = alvo.toLocaleDateString("pt-BR");
  const message = buildDailySummaryMessage(workspace.name, metric, periodo);

  const report = await prisma.whatsappReport.create({
    data: { workspaceId: workspace.id, scheduledAt: new Date(), status: "scheduled" },
  });

  try {
    const { messageId, via } = await sendWhatsappAlert(
      config.phoneNumber,
      whatsappTemplates.dailyReport(),
      dailyReportParams(workspace.name, metric),
      message,
    );

    await prisma.whatsappReport.update({
      where: { id: report.id },
      data: { status: "sent", sentAt: new Date(), providerMessageId: messageId, payload: { message, via } },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        action: "whatsapp.report.sent_manually",
        metadata: { date: periodo, via, messageId },
      },
    });

    return NextResponse.json({ ok: true, via, messageId, date: periodo, message });
  } catch (err) {
    const erro = err instanceof Error ? err.message : "Falha ao enviar o relatório.";
    await prisma.whatsappReport.update({
      where: { id: report.id },
      data: { status: "failed", errorMessage: erro, payload: { message } },
    });
    return NextResponse.json({ error: erro, message }, { status: 400 });
  }
}
