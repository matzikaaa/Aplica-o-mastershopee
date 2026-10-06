import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { importacaoAtual, sincronizarAutomatico } from "@/lib/shopee-import";

export const maxDuration = 60;

/** Curto de propósito: ninguém está esperando esta rodada, ela é de fundo. */
const ORCAMENTO_MS = 20_000;

/**
 * Intervalo mínimo entre duas rodadas automáticas da mesma conta.
 *
 * Sem ele, cada navegação entre telas dispararia uma sincronização e a conta
 * gastaria a cota da Shopee para descobrir que nada mudou. Dez minutos é
 * curto o bastante para o painel estar fresco quando alguém abre, e longo o
 * bastante para uma tarde de uso não virar centenas de chamadas.
 */
const INTERVALO_MS = 10 * 60 * 1000;

/**
 * A sincronização que acontece sem ninguém pedir.
 *
 * Disparada quando o painel é aberto. O Cron da Vercel no plano gratuito roda
 * uma vez por dia — suficiente para o relatório da manhã, longe de suficiente
 * para quem abre o painel à tarde e quer ver a venda que acabou de acontecer.
 * Quem está olhando a tela é o melhor gatilho que existe de graça.
 *
 * Importação de histórico em andamento é continuada aqui também: assim ela
 * avança mesmo quando a aba que a começou foi fechada.
 */
export async function POST() {
  const { workspace } = await requireWorkspace();

  const contas = await prisma.marketplaceAccount.findMany({
    where: {
      workspaceId: workspace.id,
      marketplace: "SHOPEE",
      status: { not: "DISCONNECTED" },
      credential: { isNot: null },
    },
  });

  const resultados = [];

  for (const conta of contas) {
    const trabalho = await importacaoAtual(conta.id);
    const historicoAberto = trabalho?.status === "RUNNING";

    // A espera não se aplica a uma importação pela metade: ela precisa de
    // rodadas seguidas para terminar, e é justamente quando alguém está com
    // a tela aberta que vale avançá-la.
    const recente =
      !historicoAberto &&
      conta.lastSyncAt !== null &&
      Date.now() - conta.lastSyncAt.getTime() < INTERVALO_MS;

    if (recente) {
      resultados.push({ conta: conta.displayName, modo: "recente", gravados: 0 });
      continue;
    }

    const r = await sincronizarAutomatico(conta, ORCAMENTO_MS);
    resultados.push({ conta: conta.displayName, ...r });
  }

  const gravados = resultados.reduce((t, r) => t + r.gravados, 0);
  return NextResponse.json({ ok: true, gravados, resultados });
}
