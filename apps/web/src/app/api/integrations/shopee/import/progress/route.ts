import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/session";
import { resolveShopeeAccount } from "@/lib/shopee-account";
import { descreverProgresso, importacaoAtual } from "@/lib/shopee-import";

/**
 * Onde a importação está, sem tocar na Shopee.
 *
 * Existe para a tela reencontrar um trabalho em andamento depois de um
 * recarregamento — ou de uma aba fechada por engano. O trabalho vive no
 * banco, não na página.
 */
export async function GET() {
  const { workspace } = await requireWorkspace();

  const account = await resolveShopeeAccount(workspace.id);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const sync = await importacaoAtual(account.id);
  if (!sync) return NextResponse.json({ nenhuma: true });

  return NextResponse.json(descreverProgresso(sync));
}
