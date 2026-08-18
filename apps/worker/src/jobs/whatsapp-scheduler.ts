import { prisma } from "@mastershopee/database";

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

    if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: {
          status: "failed",
          errorMessage: "WhatsApp Business Platform não configurado (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID pendentes).",
          payload: { message },
        },
      });
      continue;
    }

    try {
      const providerMessageId = await sendWhatsappMessage(config.phoneNumber, message);
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "sent", sentAt: new Date(), providerMessageId, payload: { message } },
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

export function buildDailySummaryMessage(workspaceName: string, metric: { grossRevenue: unknown; netProfit: unknown; orderCount: number; adSpend: unknown }): string {
  const margin = Number(metric.grossRevenue) === 0 ? 0 : (Number(metric.netProfit) / Number(metric.grossRevenue)) * 100;
  return [
    `Bom dia! 👋 Aqui está o resultado de ontem em ${workspaceName}:`,
    `💰 Faturamento: ${formatBRL(metric.grossRevenue)}`,
    `💵 Lucro líquido: ${formatBRL(metric.netProfit)}`,
    `📈 Margem: ${margin.toFixed(2)}%`,
    `📦 Pedidos: ${metric.orderCount}`,
    `📢 ADS: ${formatBRL(metric.adSpend)}`,
    `Acesse seu painel para ver os detalhes.`,
  ].join("\n");
}

function formatBRL(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

export function zonedTime(timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return new Date(Number(get("year")), Number(get("month")) - 1, Number(get("day")), Number(get("hour")), Number(get("minute")), Number(get("second")));
}

/** WhatsApp Business Platform (Cloud API) — https://developers.facebook.com/docs/whatsapp/cloud-api */
async function sendWhatsappMessage(toPhoneNumber: string, text: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhoneNumber.replace(/\D/g, ""),
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API respondeu ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? "unknown";
}
