import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/session";
import { resolveShopeeAccount } from "@/lib/shopee-account";
import { abrirImportacao, descreverProgresso } from "@/lib/shopee-import";

/** Abre (ou reabre) a importação do histórico. Não busca nada: só planeja. */
export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();

  const account = await resolveShopeeAccount(workspace.id);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const body = (await request.json().catch(() => ({}))) as { dias?: number };
  const dias = Math.min(Math.max(body.dias ?? 120, 1), 365);

  const sync = await abrirImportacao(account, dias);
  return NextResponse.json(descreverProgresso(sync));
}
