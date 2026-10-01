import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/session";
import { resolveShopeeAccount } from "@/lib/shopee-account";
import { avancarImportacao } from "@/lib/shopee-import";

export const maxDuration = 60;

/**
 * Orçamento de trabalho por rodada, bem abaixo do teto da função.
 *
 * A folga não é desperdício: é o que garante que a resposta saia como JSON.
 * Estourar `maxDuration` devolve uma página de erro da plataforma, e foi
 * isso que a tela vinha recebendo — um 504 em HTML que nem dava para ler.
 */
const ORCAMENTO_MS = 25_000;

export async function POST() {
  const { workspace } = await requireWorkspace();

  const account = await resolveShopeeAccount(workspace.id);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const progresso = await avancarImportacao(account, ORCAMENTO_MS);
  return NextResponse.json(progresso);
}
