import { prisma, resolveFreshCredentials, type MarketplaceAccount } from "@mastershopee/database";
import { decryptSecret, encryptSecret, type ProviderCredentials } from "@mastershopee/integrations";
import { periodoDoMes } from "./fechamento-mensal";
import { criarProvider } from "./shopee-import";

/** Pedidos lidos por vez do banco; a Shopee recebe de 50 em 50. */
const LOTE_DO_BANCO = 500;
const LOTE_DA_SHOPEE = 50;

export interface ResultadoDaBusca {
  consultados: number;
  encontradas: number;
  /** Pedidos do mês ainda sem nota depois do cursor — 0 quando a busca terminou. */
  faltam: number;
  /** Último pedido consultado; a próxima chamada continua dali. */
  cursor: string;
  erro: string | null;
}

/**
 * Traz da Shopee a nota fiscal dos pedidos de um mês que ainda não a têm.
 *
 * Pedidos sincronizados antes de o detalhe pedir a nota não a têm no banco,
 * e a sincronização não volta a ler pedido concluído. Esta busca lê só a nota
 * — uma chamada a cada 50 pedidos, nenhuma de escrow, porque os valores já
 * estão gravados — e a guarda no payload do pedido, onde o fechamento a lê.
 *
 * Anda em ordem de id e devolve até onde chegou: a tela chama de novo a partir
 * do cursor até `faltam` zerar, e cada chamada cabe no tempo de uma função.
 * Pedido sem nota na Shopee fica para trás nesta passada e volta a ser
 * consultado só numa busca nova — é quem clica que decide perguntar de novo.
 */
export async function buscarNotasDoMes(
  workspaceId: string,
  timezone: string,
  mes: string,
  cursorInicial: string,
  orcamentoMs: number,
): Promise<ResultadoDaBusca> {
  const inicio = Date.now();
  const contas = await prisma.marketplaceAccount.findMany({
    where: { workspaceId, marketplace: "SHOPEE", status: { not: "DISCONNECTED" }, credential: { isNot: null } },
    orderBy: [{ connectedAt: "desc" }, { createdAt: "desc" }],
  });
  if (contas.length === 0) {
    return { consultados: 0, encontradas: 0, faltam: 0, cursor: cursorInicial, erro: "Nenhuma conta Shopee conectada." };
  }
  const principal = contas[0]!;
  const conectadas = new Map(contas.map((c) => [c.id, c]));
  const range = periodoDoMes(mes, timezone);

  // Os pedidos importados por planilha ficam numa conta própria, sem token;
  // o número do pedido é o mesmo da Shopee, então a conta conectada responde.
  const contaDe = (accountId: string): MarketplaceAccount => conectadas.get(accountId) ?? principal;

  const provider = criarProvider();
  const credenciais = new Map<string, ProviderCredentials>();
  const credenciaisDe = async (conta: MarketplaceAccount) => {
    const ja = credenciais.get(conta.id);
    if (ja) return ja;
    const nova = await resolveFreshCredentials({
      accountId: conta.id,
      externalShopId: conta.externalShopId,
      provider,
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    });
    credenciais.set(conta.id, nova);
    return nova;
  };

  const semNota = (depoisDe: string, limite: number) =>
    prisma.$queryRaw<{ id: string; externalOrderId: string; marketplaceAccountId: string }[]>`
      SELECT "id", "externalOrderId", "marketplaceAccountId"
      FROM "Order"
      WHERE "workspaceId" = ${workspaceId} AND "marketplace" = 'SHOPEE'
        AND "orderedAt" >= ${range.from} AND "orderedAt" <= ${range.to}
        AND "id" > ${depoisDe}
        AND coalesce("rawPayload"->'detail'->'invoice_data'->>'access_key', '') = ''
      ORDER BY "id"
      LIMIT ${limite}`;

  let cursor = cursorInicial;
  let consultados = 0;
  let encontradas = 0;
  let erro: string | null = null;

  try {
    leitura: for (;;) {
      const pedidos = await semNota(cursor, LOTE_DO_BANCO);
      if (pedidos.length === 0) break;

      // Lotes de até 50 seguidos da mesma conta, na ordem do cursor.
      let i = 0;
      while (i < pedidos.length) {
        // Um lote sempre: conferir o relógio antes do primeiro deixaria uma
        // chamada com pouco tempo sobrando voltar sem andar nada.
        if (consultados > 0 && Date.now() - inicio >= orcamentoMs) break leitura;
        const conta = contaDe(pedidos[i]!.marketplaceAccountId);
        const lote: typeof pedidos = [];
        while (i < pedidos.length && lote.length < LOTE_DA_SHOPEE && contaDe(pedidos[i]!.marketplaceAccountId).id === conta.id) {
          lote.push(pedidos[i]!);
          i++;
        }

        const notas = await provider.fetchInvoiceData(
          await credenciaisDe(conta),
          lote.map((p) => p.externalOrderId),
        );
        for (const pedido of lote) {
          if (!notas.has(pedido.externalOrderId)) continue;
          const nota = notas.get(pedido.externalOrderId) ?? null;
          await prisma.$executeRaw`
            UPDATE "Order"
            SET "rawPayload" = jsonb_set(
              CASE WHEN jsonb_typeof("rawPayload") = 'object' THEN "rawPayload" ELSE '{}'::jsonb END,
              '{detail}',
              (CASE WHEN jsonb_typeof("rawPayload"->'detail') = 'object' THEN "rawPayload"->'detail' ELSE '{}'::jsonb END)
                || jsonb_build_object('invoice_data', ${JSON.stringify(nota)}::jsonb)
            )
            WHERE "id" = ${pedido.id}`;
          if (nota?.access_key) encontradas++;
        }
        consultados += lote.length;
        cursor = lote[lote.length - 1]!.id;
      }
    }
  } catch (err) {
    erro = err instanceof Error ? err.message : "Falha ao consultar a Shopee.";
  }

  const restantes = await prisma.$queryRaw<{ faltam: number }[]>`
    SELECT count(*)::int AS faltam
    FROM "Order"
    WHERE "workspaceId" = ${workspaceId} AND "marketplace" = 'SHOPEE'
      AND "orderedAt" >= ${range.from} AND "orderedAt" <= ${range.to}
      AND "id" > ${cursor}
      AND coalesce("rawPayload"->'detail'->'invoice_data'->>'access_key', '') = ''`;

  return { consultados, encontradas, faltam: restantes[0]?.faltam ?? 0, cursor, erro };
}
