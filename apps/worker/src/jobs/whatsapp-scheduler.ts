import { prisma } from "@mastershopee/database";
import {
  buildDailySummaryMessage,
  dailyReportParams,
  zonedTime,
} from "@mastershopee/shared";
import { isWhatsappConfigured, sendWhatsappAlert, whatsappTemplates, WHATSAPP_NOT_CONFIGURED } from "../whatsapp.js";

/**
 * §22-24, §64: runs every minute (see scheduler.ts). For each workspace
 * whose configured `dailyReportTime` matches "now" in its own timezone, and
 * hasn't already sent today, builds the daily summary and sends it via the
 * WhatsApp Business Platform Cloud API.
 *
 * PENDING: WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID (Meta Business
 * verification + approved message template — see .env.example). Without
 * them this still records a WhatsappReport row with status "failed" and a
 * clear error, rather than silently doing nothing or faking a delivery.
 */
export async function runWhatsappScheduler(): Promise<void> {
  const configs = await prisma.whatsappConfiguration.findMany({
    where: { dailyReportEnabled: true, verified: true },
    include: { workspace: true },
  });

  for (const config of configs) {
    const nowInTz = zonedTime(config.workspace.timezone);
    const currentHHMM = `${String(nowInTz.getHours()).padStart(2, "0")}:${String(nowInTz.getMinutes()).padStart(2, "0")}`;
    if (config.dailyReportTime !== currentHHMM) continue;

    const todayStart = new Date(nowInTz);
    todayStart.setHours(0, 0, 0, 0);
    const alreadySent = await prisma.whatsappReport.findFirst({
      where: { workspaceId: config.workspaceId, scheduledAt: { gte: todayStart }, status: { in: ["sent", "scheduled"] } },
    });
    if (alreadySent) continue;

    const yesterday = new Date(todayStart);
    yesterday.setDate(yesterday.getDate() - 1);

    const metric = await prisma.dailyMetric.findUnique({
      where: { workspaceId_date: { workspaceId: config.workspaceId, date: yesterday } },
    });

    const report = await prisma.whatsappReport.create({
      data: { workspaceId: config.workspaceId, scheduledAt: nowInTz, status: "scheduled" },
    });

    if (!metric) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "failed", errorMessage: "Sem dados do dia anterior para reportar." },
      });
      continue;
    }

    const message = buildDailySummaryMessage(config.workspace.name, metric);

    if (!isWhatsappConfigured()) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: {
          status: "failed",
          errorMessage: WHATSAPP_NOT_CONFIGURED,
          payload: { message },
        },
      });
      continue;
    }

    try {
      // Business-initiated, so it goes out as the approved template. The
      // assembled text travels along as the fallback and as the record of
      // what was actually said.
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
      await prisma.notification.create({
        data: { workspaceId: config.workspaceId, title: "Relatório diário enviado", body: `Resumo de ontem enviado para ${config.phoneNumber}.` },
      });
    } catch (err) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "failed", errorMessage: err instanceof Error ? err.message : "Falha ao enviar mensagem." },
      });
    }
  }
}
