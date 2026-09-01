import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import {
  isWhatsappConfigured,
  sendWhatsappAlert,
  whatsappTemplates,
  WHATSAPP_NOT_CONFIGURED,
} from "@mastershopee/integrations";
import { buildDailySummaryMessage, dailyReportParams, zonedTime } from "@mastershopee/shared";

/**
 * A rotina diária, disparada pelo Cron da Vercel.
 *
 * O agendador de verdade vive no worker, que precisa de Redis e de uma
 * máquina que fique de pé. Enquanto isso não existe, o relatório diário
 * dependia de alguém clicar — o que não é uma automação, é uma lembrança.
 *
 * Esta rota faz o mesmo trabalho do agendador para os workspaces cujo horário
 * configurado já passou hoje e que ainda não receberam. Quando o worker
 * entrar, ele assume e esta rota pode sair; até lá é o que existe de real.
 *
 * Protegida por CRON_SECRET: a Vercel manda o header `Authorization: Bearer`
 * com esse valor. Sem a variável configurada a rota recusa tudo, em vez de
 * ficar aberta na internet disparando mensagens.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado — rota desativada por segurança." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const configs = await prisma.whatsappConfiguration.findMany({
    where: { dailyReportEnabled: true, verified: true },
    include: { workspace: true },
  });

  const resultados: { workspace: string; status: string; detalhe?: string }[] = [];

  for (const config of configs) {
    const agora = zonedTime(config.workspace.timezone);
    const inicioDoDia = new Date(agora);
    inicioDoDia.setHours(0, 0, 0, 0);

    // O cron roda em horários fixos; o vendedor escolhe o dele. Comparar
    // "já passou da hora e ainda não mandei hoje" é o que faz os dois se
    // encontrarem sem exigir um cron por minuto.
    const [hh, mm] = (config.dailyReportTime ?? "08:00").split(":").map(Number);
    const horario = new Date(inicioDoDia);
    horario.setHours(hh ?? 8, mm ?? 0, 0, 0);
    if (agora < horario) {
      resultados.push({ workspace: config.workspace.name, status: "ainda não é hora" });
      continue;
    }

    const jaEnviado = await prisma.whatsappReport.findFirst({
      where: {
        workspaceId: config.workspaceId,
        scheduledAt: { gte: inicioDoDia },
        status: { in: ["sent", "scheduled"] },
      },
    });
    if (jaEnviado) {
      resultados.push({ workspace: config.workspace.name, status: "já enviado hoje" });
      continue;
    }

    const ontem = new Date(inicioDoDia.getTime() - 24 * 3600 * 1000);
    const metric = await prisma.dailyMetric.findUnique({
      where: { workspaceId_date: { workspaceId: config.workspaceId, date: ontem } },
    });

    const report = await prisma.whatsappReport.create({
      data: { workspaceId: config.workspaceId, scheduledAt: agora, status: "scheduled" },
    });

    if (!metric) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "failed", errorMessage: "Sem dados do dia anterior para reportar." },
      });
      resultados.push({ workspace: config.workspace.name, status: "sem dados de ontem" });
      continue;
    }

    const message = buildDailySummaryMessage(config.workspace.name, metric);

    if (!isWhatsappConfigured()) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "failed", errorMessage: WHATSAPP_NOT_CONFIGURED, payload: { message } },
      });
      resultados.push({ workspace: config.workspace.name, status: "WhatsApp não configurado" });
      continue;
    }

    try {
      const { messageId, via } = await sendWhatsappAlert(
        config.phoneNumber,
        whatsappTemplates.dailyReport(),
        dailyReportParams(config.workspace.name, metric),
        message,
      );
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "sent", sentAt: new Date(), providerMessageId: messageId, payload: { message, via } },
      });
      resultados.push({ workspace: config.workspace.name, status: "enviado" });
    } catch (err) {
      const erro = err instanceof Error ? err.message : "Falha ao enviar.";
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "failed", errorMessage: erro, payload: { message } },
      });
      resultados.push({ workspace: config.workspace.name, status: "falhou", detalhe: erro });
    }
  }

  return NextResponse.json({ ok: true, workspaces: configs.length, resultados });
}
