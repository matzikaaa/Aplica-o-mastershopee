import { NextResponse } from "next/server";
import {
  collectLowStock,
  markLowStockNotified,
  prisma,
  recomputeMetricsForDays,
  resolveFreshCredentials,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import {
  isWhatsappConfigured,
  sendWhatsappAlert,
  whatsappTemplates,
  WHATSAPP_NOT_CONFIGURED,
} from "@mastershopee/integrations";
import {
  buildDailySummaryMessage,
  dailyReportParams,
  morningBriefParams,
  zonedTime,
} from "@mastershopee/shared";
import { ShopeeProvider, decryptSecret, encryptSecret } from "@mastershopee/integrations";
import { getIntegrationEnv } from "@/lib/integration-env";

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

  // Sincroniza antes de relatar: um relatório montado sobre dados de
  // anteontem diz um número errado com toda a confiança.
  const sincronizacao = await sincronizarPedidos();

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

    // Estoque na mesma mensagem, por pedido do operador: dois avisos na
    // mesma manhã pela mesma operação viram dois ruídos, e o segundo passa a
    // ser ignorado junto com o primeiro.
    const estoque = await collectLowStock(config.workspaceId);
    const message = buildDailySummaryMessage(config.workspace.name, metric, "ontem", estoque);

    if (!isWhatsappConfigured()) {
      await prisma.whatsappReport.update({
        where: { id: report.id },
        data: { status: "failed", errorMessage: WHATSAPP_NOT_CONFIGURED, payload: { message } },
      });
      resultados.push({ workspace: config.workspace.name, status: "WhatsApp não configurado" });
      continue;
    }

    try {
      // O template combinado tem 7 parâmetros e leva o estoque junto. Sem
      // ele configurado, cai no de 6: o resultado chega igual e o estoque
      // fica no texto e na notificação do painel, em vez de o envio falhar.
      const combinado = whatsappTemplates.morningBrief();
      const { messageId, via } = combinado
        ? await sendWhatsappAlert(
            config.phoneNumber,
            combinado,
            morningBriefParams(config.workspace.name, metric, estoque),
            message,
          )
        : await sendWhatsappAlert(
            config.phoneNumber,
            whatsappTemplates.dailyReport(),
            dailyReportParams(config.workspace.name, metric),
            message,
          );

      // Só depois de a mensagem sair: marcar antes faria um envio falho
      // silenciar o aviso até a próxima reposição.
      await markLowStockNotified(estoque.map((i) => i.stockItemId));

      if (estoque.length > 0) {
        await prisma.notification.create({
          data: {
            workspaceId: config.workspaceId,
            title: `${estoque.length} produto(s) precisam de reposição`,
            body: estoque
              .map((i) => `${i.sku}: ${i.quantity} un${i.isOutOfStock ? " (ZERADO)" : ""}`)
              .join("\n"),
          },
        });
      }
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

  return NextResponse.json({ ok: true, sincronizacao, workspaces: configs.length, resultados });
}

/**
 * Sincronização incremental de todas as contas Shopee conectadas.
 *
 * Enquanto o worker não está hospedado, este é o único caminho automático
 * para os pedidos entrarem — sem ele o vendedor teria que abrir o painel e
 * clicar em "Importar" todo dia, o que não é sincronização.
 *
 * Incremental de propósito: retoma pelo cursor de cada conta e busca uma
 * página por conta por execução. Puxar histórico é trabalho de quem clicou
 * no botão, que pode acompanhar; aqui o objetivo é não deixar o dia de
 * ontem faltando quando o relatório for montado.
 */
async function sincronizarPedidos() {
  const contas = await prisma.marketplaceAccount.findMany({
    where: { marketplace: "SHOPEE", status: { not: "DISCONNECTED" }, credential: { isNot: null } },
  });

  const env = getIntegrationEnv();
  const resultado: { conta: string; pedidos: number; erro?: string }[] = [];

  for (const conta of contas) {
    const provider = new ShopeeProvider(
      env.SHOPEE_PARTNER_ID ?? "",
      env.SHOPEE_PARTNER_KEY ?? "",
      env.SHOPEE_REDIRECT_URL ?? "",
      env.SHOPEE_ENV ?? "live",
      env.SHOPEE_KEY_ENCODING ?? "raw",
    );

    try {
      const credentials = await resolveFreshCredentials({
        accountId: conta.id,
        externalShopId: conta.externalShopId,
        provider,
        encrypt: encryptSecret,
        decrypt: decryptSecret,
      });

      const page = await provider.fetchOrders(
        credentials,
        { value: conta.lastSyncCursor },
        conta.lastSyncAt ?? new Date(Date.now() - 3 * 24 * 3600 * 1000),
      );

      const dias = new Set<string>();
      for (const pedido of page.items) {
        await upsertNormalizedOrder(conta, pedido);
        dias.add(pedido.orderedAt.toISOString().slice(0, 10));
      }
      if (dias.size > 0) await recomputeMetricsForDays(conta.workspaceId, [...dias]);

      await prisma.marketplaceAccount.update({
        where: { id: conta.id },
        data: {
          status: "CONNECTED",
          lastSyncAt: new Date(),
          lastSyncCursor: page.nextCursor.value,
          lastErrorMessage: null,
        },
      });

      resultado.push({ conta: conta.displayName, pedidos: page.items.length });
    } catch (err) {
      const erro = err instanceof Error ? err.message : "falha desconhecida";
      await prisma.marketplaceAccount.update({
        where: { id: conta.id },
        data: { lastErrorMessage: erro },
      });
      // Uma conta com problema não pode impedir a sincronização das outras
      // nem o envio dos relatórios de quem está bem.
      resultado.push({ conta: conta.displayName, pedidos: 0, erro });
    }
  }

  return resultado;
}
