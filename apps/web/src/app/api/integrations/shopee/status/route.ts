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

  // O cursor guarda "epoch da janela | cursor da Shopee". Traduzido, ele diz
  // em que ponto do histórico a próxima rodada vai continuar.
  const [janelaRaw] = (account.lastSyncCursor ?? "").split("|");
  const janela = janelaRaw ? new Date(Number(janelaRaw) * 1000) : null;

  return NextResponse.json({
    conta: account.displayName,
    status: account.status,
    ultimoErro: account.lastErrorMessage,
    pedidos: {
      total,
      maisAntigo: primeiro?.orderedAt ?? null,
      maisRecente: ultimo?.orderedAt ?? null,
    },
    proximaJanela: janela,
    cursorBruto: account.lastSyncCursor,
    ultimaSincronizacao: account.lastSyncAt,
    produtos: { total: produtos, semCusto },
    itensSemCustoConhecido: itensSemCusto,
  });
}
