import { NextResponse } from "next/server";
import { countItemsWithUnknownCost, prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { resolveShopeeAccount } from "@/lib/shopee-account";

/**
 * Onde a importação está, em números.
 *
 * Construído depois de uma manhã inteira de "clique e me diga o que
 * aconteceu": sem enxergar o estado, cada rodada de diagnóstico custava uma
 * ida e volta com o operador e ainda assim terminava em suposição. O cursor
 * decodificado é o que responde "avançou ou travou" — contar pedidos não
 * serve, porque uma janela sem vendas grava zero e mesmo assim andou.
 */
export async function GET() {
  const { workspace } = await requireWorkspace();

  const account = await resolveShopeeAccount(workspace.id);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const [total, primeiro, ultimo, produtos, semCusto, itensSemCusto] = await Promise.all([
    prisma.order.count({ where: { marketplaceAccountId: account.id } }),
    prisma.order.findFirst({
      where: { marketplaceAccountId: account.id },
      orderBy: { orderedAt: "asc" },
      select: { orderedAt: true },
    }),
    prisma.order.findFirst({
      where: { marketplaceAccountId: account.id },
      orderBy: { orderedAt: "desc" },
      select: { orderedAt: true },
    }),
    prisma.product.count({ where: { workspaceId: workspace.id } }),
    prisma.product.count({ where: { workspaceId: workspace.id, costs: { none: {} } } }),
    countItemsWithUnknownCost(workspace.id),
  ]);

  const progresso = descreverProgresso(account.lastSyncCursor);

  return NextResponse.json({
    conta: account.displayName,
    status: account.status,
    ultimoErro: account.lastErrorMessage,
    pedidos: {
      total,
      maisAntigo: primeiro?.orderedAt ?? null,
      maisRecente: ultimo?.orderedAt ?? null,
    },
    progresso,
    cursorBruto: account.lastSyncCursor,
    ultimaSincronizacao: account.lastSyncAt,
    produtos: { total: produtos, semCusto },
    itensSemCustoConhecido: itensSemCusto,
  });
}

/** Mesma janela que o provedor usa: a Shopee só consulta 15 dias por chamada. */
const JANELA_MS = 15 * 24 * 3600 * 1000;

/**
 * O que o cursor quer dizer, em português.
 *
 * O cursor é "epoch da janela | cursor da Shopee", e mostrar só a data da
 * janela mentia por omissão: enquanto a importação pagina *dentro* de uma
 * janela cheia, essa data não muda por rodadas seguidas. A tela repetia
 * "continua a partir de 28/06" enquanto o total de pedidos subia de 252 para
 * 603 — parado, para quem lia, e andando, de verdade. Já perdemos um dia
 * confiando numa leitura assim; a parte do cursor que estava sendo ignorada é
 * justamente a que prova o avanço.
 */
function descreverProgresso(cursor: string | null) {
  if (!cursor) return { fase: "concluido" as const, inicio: null, fim: null };

  const [janelaRaw, cursorInterno = ""] = cursor.split("|");
  const inicioMs = janelaRaw ? Number(janelaRaw) * 1000 : NaN;
  if (!Number.isFinite(inicioMs)) {
    return { fase: "desconhecido" as const, inicio: null, fim: null };
  }

  const inicio = new Date(inicioMs);
  const fim = new Date(Math.min(inicioMs + JANELA_MS, Date.now()));

  // Cursor interno presente = ainda há páginas nesta janela. Ausente = a
  // janela acabou e a próxima rodada abre a seguinte.
  return { fase: cursorInterno ? ("dentro-da-janela" as const) : ("proxima-janela" as const), inicio, fim };
}
