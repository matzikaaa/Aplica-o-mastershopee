import {
  prisma,
  createSyncCache,
  pedidosJaCompletos,
  recomputeMetricsForDays,
  resolveFreshCredentials,
  upsertNormalizedOrder,
  type MarketplaceAccount,
} from "@mastershopee/database";
import { ShopeeProvider, decryptSecret, encryptSecret } from "@mastershopee/integrations";
import {
  JANELA_SEGUNDOS,
  fimDaJanela,
  lerEstado,
  novoEstado,
  percentualConcluido,
  serializarEstado,
  totalDeJanelas,
  type EstadoImportacao,
} from "@mastershopee/shared";
import { getIntegrationEnv } from "./integration-env";

/**
 * A importação do histórico como um trabalho que o servidor retoma, não como
 * uma requisição que precisa caber no relógio.
 *
 * A forma anterior pedia que uma função serverless terminasse um pedaço
 * grande dentro de 60 segundos. Quando o pedaço crescia, ela morria sem
 * gravar, o ponto de retomada não avançava e a tentativa seguinte repetia o
 * mesmo pedaço — travamento, não lentidão, e dos que não passam com o tempo.
 *
 * Três decisões tiram esse risco da raiz:
 *
 * 1. **As janelas são planejadas antes de começar.** A Shopee consulta 15
 *    dias por vez; 120 dias são 8 janelas, conhecidas de saída. O progresso
 *    passa a ser uma fração de verdade ("janela 3 de 8") em vez de um cursor
 *    opaco que ninguém sabe ler.
 *
 * 2. **Perguntar ao banco antes de gastar.** Listar 50 pedidos é uma chamada;
 *    descrevê-los é uma chamada mais uma de escrow por pedido. Consultando
 *    quais já estão completos, uma rodada sobre histórico já baixado custa
 *    uma chamada e uma consulta — não mais do que baixá-lo de novo.
 *
 * 3. **Nenhum pedaço precisa terminar.** Como gravar é idempotente e o que
 *    foi gravado é pulado de graça na próxima rodada, interromper no meio
 *    não perde nem repete trabalho. É isso que torna o travamento
 *    estruturalmente impossível: toda rodada ou grava algo, ou descobre de
 *    graça que não havia o que gravar — e as duas avançam.
 */

/** Pedidos novos descritos por lote, com o orçamento conferido entre lotes. */
const LOTE = 10;

export interface Progresso {
  status: "RUNNING" | "COMPLETED" | "FAILED" | "QUEUED" | "PARTIAL";
  janela: number;
  janelas: number;
  percentual: number;
  pedidosGravados: number;
  desde: string;
  ate: string | null;
  erro: string | null;
  concluido: boolean;
}

function agora(): number {
  return Math.floor(Date.now() / 1000);
}

export function descreverProgresso(
  sync: { status: string; cursor: string | null; itemsProcessed: number; errorMessage: string | null },
): Progresso {
  const estado = lerEstado(sync.cursor);
  const concluido = sync.status === "COMPLETED";
  const hoje = agora();

  if (!estado) {
    return {
      status: sync.status as Progresso["status"],
      janela: 0,
      janelas: 1,
      percentual: concluido ? 100 : 0,
      pedidosGravados: sync.itemsProcessed,
      desde: new Date(hoje * 1000).toISOString(),
      ate: null,
      erro: sync.errorMessage,
      concluido,
    };
  }

  const janelas = totalDeJanelas(estado.ini, hoje);

  return {
    status: sync.status as Progresso["status"],
    // A janela exibida é a que está sendo varrida — uma a mais que as
    // terminadas —, limitada ao total para não anunciar "9 de 8" na última.
    janela: Math.min(estado.j + 1, janelas),
    janelas,
    percentual: percentualConcluido(estado, hoje, concluido),
    pedidosGravados: sync.itemsProcessed,
    desde: new Date(estado.ini * 1000).toISOString(),
    ate: new Date(fimDaJanela(estado, hoje) * 1000).toISOString(),
    erro: sync.errorMessage,
    concluido,
  };
}

/**
 * Abre o trabalho, ou devolve o que já está aberto.
 *
 * `lockKey` é único por conta e tipo: dois cliques no botão, ou duas abas,
 * não abrem duas importações concorrentes disputando o mesmo cursor.
 */
export async function abrirImportacao(account: MarketplaceAccount, dias: number) {
  const lockKey = `${account.id}:ORDERS`;

  const existente = await prisma.integrationSync.findUnique({ where: { lockKey } });
  if (existente && existente.status === "RUNNING") return existente;

  const estado: EstadoImportacao = novoEstado(agora() - dias * 24 * 3600);

  if (existente) {
    return prisma.integrationSync.update({
      where: { id: existente.id },
      data: {
        status: "RUNNING",
        cursor: serializarEstado(estado),
        itemsProcessed: 0,
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
      },
    });
  }

  return prisma.integrationSync.create({
    data: {
      workspaceId: account.workspaceId,
      marketplaceAccountId: account.id,
      type: "ORDERS",
      status: "RUNNING",
      cursor: serializarEstado(estado),
      startedAt: new Date(),
      lockKey,
    },
  });
}

export async function importacaoAtual(accountId: string) {
  return prisma.integrationSync.findUnique({ where: { lockKey: `${accountId}:ORDERS` } });
}

/**
 * Avança o trabalho pelo tempo que couber e devolve onde parou.
 *
 * Nunca lança: uma falha da Shopee no meio de uma varredura de meses não é
 * motivo para a tela quebrar. Ela é gravada no trabalho, o progresso até ali
 * é mantido, e a rodada seguinte continua do mesmo ponto.
 */
export async function avancarImportacao(
  account: MarketplaceAccount,
  orcamentoMs: number,
): Promise<Progresso> {
  const sync = await importacaoAtual(account.id);
  if (!sync) throw new Error("Nenhuma importação aberta para esta conta.");

  const estado = lerEstado(sync.cursor);
  if (!estado) throw new Error("O ponto de retomada está ilegível. Comece a importação de novo.");

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  const inicio = Date.now();
  const cache = createSyncCache();
  const diasTocados = new Set<string>();
  let gravados = 0;
  let erro: string | null = null;
  let concluiu = false;

  try {
    const credenciais = await resolveFreshCredentials({
      accountId: account.id,
      externalShopId: account.externalShopId,
      provider,
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    });

    while (Date.now() - inicio < orcamentoMs) {
      const de = estado.ini + estado.j * JANELA_SEGUNDOS;
      if (de >= agora()) {
        concluiu = true;
        break;
      }
      const ate = fimDaJanela(estado, agora());

      const { orderSns, nextCursor } = await provider.listOrderIds(credenciais, de, ate, estado.c);

      // A pergunta barata antes do gasto caro.
      const completos = await pedidosJaCompletos(account.id, orderSns);
      const faltando = orderSns.filter((sn) => !completos.has(sn));

      let paradoNoMeio = false;
      for (let i = 0; i < faltando.length; i += LOTE) {
        if (Date.now() - inicio >= orcamentoMs) {
          paradoNoMeio = true;
          break;
        }
        const pedidos = await provider.fetchOrdersByIds(credenciais, faltando.slice(i, i + LOTE));
        for (const pedido of pedidos) {
          await upsertNormalizedOrder(account, pedido, cache);
          gravados++;
          diasTocados.add(pedido.orderedAt.toISOString().slice(0, 10));
        }
      }

      // Parar no meio de uma página não avança o cursor — e não precisa. O
      // que foi gravado será pulado de graça na próxima rodada, porque a
      // consulta de "já completos" vai encontrá-lo. É o que dispensa um
      // cursor interno à página sem reintroduzir repetição de trabalho.
      if (paradoNoMeio) break;

      if (nextCursor) {
        estado.c = nextCursor;
      } else {
        estado.j += 1;
        estado.c = "";
      }
    }
  } catch (err) {
    erro = err instanceof Error ? err.message : "Falha ao consultar a Shopee.";
  }

  if (diasTocados.size > 0) {
    await recomputeMetricsForDays(account.workspaceId, [...diasTocados]);
  }

  const atualizado = await prisma.integrationSync.update({
    where: { id: sync.id },
    data: {
      cursor: serializarEstado(estado),
      itemsProcessed: { increment: gravados },
      status: concluiu ? "COMPLETED" : erro ? "PARTIAL" : "RUNNING",
      // O lockKey é mantido mesmo depois de concluir: ele é a chave pela qual
      // esta conta reencontra o próprio trabalho, e é `abrirImportacao` que
      // reabre a linha existente em vez de criar outra. Apagá-lo aqui faria a
      // tela perder o resultado assim que ele ficasse pronto.
      ...(concluiu ? { finishedAt: new Date() } : {}),
      errorMessage: erro,
    },
  });

  await prisma.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      lastSyncAt: new Date(),
      ...(erro ? { lastErrorMessage: erro } : { status: "CONNECTED", lastErrorMessage: null }),
    },
  });

  return descreverProgresso(atualizado);
}
