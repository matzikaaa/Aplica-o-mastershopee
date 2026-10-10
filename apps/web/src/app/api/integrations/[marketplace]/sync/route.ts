import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { marketplaceSyncQueue } from "@/lib/queue";
import { sincronizarAutomatico } from "@/lib/shopee-import";

export const maxDuration = 60;

/**
 * "Sincronizar agora" (§33).
 *
 * Para a Shopee, roda aqui mesmo, pelo mesmo caminho da sincronização
 * automática. Antes enfileirava um job no BullMQ, e não existe Redis em
 * produção: o clique estourava num 500 que a tela nem lia, recarregava, e
 * nada acontecia — o botão principal do card de integração não fazia nada, em
 * silêncio, para todo cliente.
 *
 * Os demais marketplaces ainda dependem do worker; para eles a fila é tentada
 * e, sem ela, a resposta diz isso em vez de fingir que algo começou.
 */
export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();
  const { accountId } = (await request.json().catch(() => ({}))) as { accountId?: string };

  const account = await prisma.marketplaceAccount.findFirst({
    where: { id: accountId, workspaceId: workspace.id },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  if (account.marketplace === "SHOPEE") {
    // Pedido explícito: sem a espera de dez minutos da rodada automática,
    // que existe para não gastar cota em navegação, não em clique.
    const r = await sincronizarAutomatico(account, 25_000);
    if (r.erro) return NextResponse.json({ error: r.erro, gravados: r.gravados }, { status: 502 });
    return NextResponse.json({ ok: true, gravados: r.gravados, modo: r.modo });
  }

  try {
    await marketplaceSyncQueue.add("manual-incremental-sync", {
      marketplaceAccountId: account.id,
      type: "INCREMENTAL",
    });
  } catch {
    return NextResponse.json(
      { error: "A sincronização deste marketplace depende do serviço de fila, que não está ativo neste ambiente." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, enfileirado: true });
}
