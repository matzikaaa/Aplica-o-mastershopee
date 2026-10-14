import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/session";
import { mesValido } from "@/lib/fechamento-mensal";
import { buscarNotasDoMes } from "@/lib/notas-fiscais";

export const maxDuration = 60;

/** Bem abaixo do teto da função, para a resposta sair como JSON e não como 504. */
const ORCAMENTO_MS = 20_000;

/**
 * Uma rodada da busca de notas fiscais de um mês na Shopee.
 *
 * A tela chama de novo com o cursor devolvido até `faltam` zerar. Só lê da
 * Shopee e grava a nota no pedido: nenhum valor do pedido muda.
 */
export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();
  const corpo = (await request.json().catch(() => ({}))) as { mes?: unknown; cursor?: unknown };
  const mes = typeof corpo.mes === "string" ? corpo.mes : undefined;
  if (!mesValido(mes)) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }
  const cursor = typeof corpo.cursor === "string" ? corpo.cursor : "";

  const r = await buscarNotasDoMes(workspace.id, workspace.timezone, mes, cursor, ORCAMENTO_MS);
  if (r.erro && r.consultados === 0) {
    return NextResponse.json({ error: r.erro, ...r }, { status: 502 });
  }
  return NextResponse.json(r);
}
