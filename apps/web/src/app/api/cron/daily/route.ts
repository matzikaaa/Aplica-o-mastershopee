import { NextResponse } from "next/server";
import {
  collectLowStock,
  markLowStockNotified,
  prisma,
  recalcularMetricasPendentes,
  runAlertChecks,
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
  chaveDoDia,
  dataDoDia,
  somarDias,
  inicioDoDia as inicioDoDiaLocal,
} from "@mastershopee/shared";
import { enviarResumoDiario } from "@/lib/daily-report-email";
import { sincronizarAutomatico } from "@/lib/shopee-import";

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

/**
 * Fatia do minuto reservada a trazer pedidos: por conta, e no total.
 *
 * O resto da rota ainda precisa montar e enviar os relatórios: gastar o
 * minuto inteiro sincronizando faria a função morrer antes de a mensagem
 * sair, e aí a automação inteira não entrega nada. O teto por conta sozinho
 * não bastava — eram 15 s por loja, em sequência, e a partir da quarta loja
 * conectada a rotina passava do minuto: nenhum resumo, nenhum alerta, para
 * nenhum cliente.
 */
const ORCAMENTO_SYNC_MS = 15_000;
const ORCAMENTO_SYNC_TOTAL_MS = 20_000;
const ORCAMENTO_RECALCULO_MS = 10_000;

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
  const recalculo = await recalcularPendentes();

  // Os alertas dependem das métricas de ontem, que a sincronização acabou de
  // recalcular. Antes só o worker os verificava — e sem worker hospedado a
  // tela de Alertas aceitava regras que nunca disparavam.
  const alertas = await runAlertChecks().catch((err: unknown) => ({
    erro: err instanceof Error ? err.message : "falha ao verificar alertas",
  }));

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

    // Chave do dia como a métrica diária é guardada, sem depender do fuso
    // do servidor.
    const ontem = dataDoDia(somarDias(chaveDoDia(new Date(), config.workspace.timezone), -1));
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

  const email = await enviarResumosPorEmail();

  return NextResponse.json({
    ok: true,
    sincronizacao,
    recalculo,
    alertas,
    whatsapp: { workspaces: configs.length, resultados },
    email,
  });
}

/**
 * Resumo diário por e-mail, para quem ativou.
 *
 * Canal independente do WhatsApp de propósito: montar uma conta na Meta
 * exige número dedicado, verificação de empresa e cartão cadastrado, e não
 * é razoável exigir isso de um vendedor só para ele receber o próprio
 * relatório. Quem tiver os dois recebe os mesmos números — o compositor é o
 * mesmo.
 */
async function enviarResumosPorEmail() {
  const workspaces = await prisma.workspace.findMany({
    where: { dailyReportEmailEnabled: true },
    select: { id: true, name: true, timezone: true, lastDailyEmailAt: true },
  });

  const resultados: { workspace: string; status: string; detalhe?: string }[] = [];

  for (const workspace of workspaces) {
    // Meia-noite do vendedor como instante real: `lastDailyEmailAt` é um
    // instante, e compará-lo com o relógio de parede escrito em UTC tratava
    // um envio das 22h de ontem como se fosse de hoje.
    const inicioDoDia = inicioDoDiaLocal(chaveDoDia(new Date(), workspace.timezone), workspace.timezone);

    if (workspace.lastDailyEmailAt && workspace.lastDailyEmailAt >= inicioDoDia) {
      resultados.push({ workspace: workspace.name, status: "já enviado hoje" });
      continue;
    }

    try {
      const r = await enviarResumoDiario(workspace.id);
      // Marca só depois do envio: marcar antes faria uma falha silenciar o
      // resumo até o dia seguinte.
      if (r.status === "enviado") {
        await prisma.workspace.update({
          where: { id: workspace.id },
          data: { lastDailyEmailAt: new Date() },
        });
      }
      resultados.push({ workspace: workspace.name, status: r.status, detalhe: r.detalhe });
    } catch (err) {
      // Um workspace com problema não pode impedir os outros de receber.
      resultados.push({
        workspace: workspace.name,
        status: "falhou",
        detalhe: err instanceof Error ? err.message : "erro",
      });
    }
  }

  return resultados;
}

/**
 * Sincronização de todas as contas Shopee conectadas, antes do relatório.
 *
 * Delega para `sincronizarAutomatico`, o mesmo caminho que o painel usa ao
 * ser aberto. Antes esta rota tinha a própria versão — uma página por conta,
 * lendo o cursor do importador antigo — e duas implementações de "trazer os
 * pedidos" é a receita conhecida para elas discordarem justamente no dia em
 * que o número do relatório importa (§60).
 *
 * Continua sendo o piso, não o teto: o Cron do plano gratuito roda uma vez
 * por dia e existe para que o relatório da manhã nunca seja montado sobre
 * dados de anteontem. O frescor durante o dia vem de quem abre o painel.
 */
async function sincronizarPedidos() {
  // A mais desatualizada primeiro: a que ficar de fora hoje é a que acabou de
  // sincronizar — em geral porque o dono abriu o painel — e amanhã é a vez
  // dela. Nenhuma loja fica dias sem atualizar porque outras vieram antes.
  const contas = await prisma.marketplaceAccount.findMany({
    where: { marketplace: "SHOPEE", status: { not: "DISCONNECTED" }, credential: { isNot: null } },
    orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } },
  });

  const resultado: { conta: string; pedidos: number; modo?: string; erro?: string }[] = [];
  const limite = Date.now() + ORCAMENTO_SYNC_TOTAL_MS;

  for (const conta of contas) {
    const sobra = limite - Date.now();
    if (sobra < 3_000) {
      resultado.push({ conta: conta.displayName, pedidos: 0, modo: "adiada para a próxima rodada" });
      continue;
    }
    // Uma conta com problema não pode impedir a sincronização das outras nem
    // o envio dos relatórios de quem está bem.
    const r = await sincronizarAutomatico(conta, Math.min(ORCAMENTO_SYNC_MS, sobra));
    resultado.push({
      conta: conta.displayName,
      pedidos: r.gravados,
      modo: r.modo,
      ...(r.erro ? { erro: r.erro } : {}),
    });
  }

  return resultado;
}

/**
 * Métricas antigas desatualizadas por mudança na regra do cálculo, em fatias.
 *
 * Fatia curta e compartilhada entre os workspaces: o resto do minuto ainda
 * precisa montar e enviar os relatórios. O que não couber hoje continua
 * amanhã — ou antes, quando alguém abrir o painel.
 */
async function recalcularPendentes() {
  const pendentes = await prisma.workspace.findMany({
    where: { metricsRecomputeFrom: { not: null } },
    select: { id: true, name: true },
  });
  const limite = Date.now() + ORCAMENTO_RECALCULO_MS;
  const resultado: { workspace: string; dias: number; terminou: boolean }[] = [];
  for (const ws of pendentes) {
    const sobra = limite - Date.now();
    if (sobra <= 0) break;
    const r = await recalcularMetricasPendentes(ws.id, sobra);
    resultado.push({ workspace: ws.name, ...r });
  }
  return resultado;
}
