import type { OrderStatus } from "@prisma/client";
import { prisma } from "./index";

/**
 * Quais destes pedidos já estão gravados e não precisam ser buscados de novo.
 *
 * Existe para a importação perguntar *antes* de gastar: descrever um pedido
 * custa uma chamada de escrow só para ele, e sem esta consulta reimportar um
 * histórico já baixado custava o mesmo que baixá-lo pela primeira vez.
 *
 * Pular exige três coisas ao mesmo tempo:
 *
 * - **taxa confirmada** (`feesAreEstimated: false`). Pedido com taxa estimada
 *   teve o escrow pedido antes de a Shopee liberar o repasse; é justamente
 *   esse que vale reconsultar, porque a próxima rodada pode fechar o valor.
 * - **itens gravados**. Pedido sem item é uma gravação que parou no meio.
 * - **o mesmo status que a Shopee acabou de listar.** Sem esta, um pedido
 *   entregue, com taxa confirmada, que vira devolução depois do repasse seria
 *   considerado "completo" e nunca mais relido — a receita ficaria contada e
 *   o estoque não voltaria. Comparar o status listado com o gravado separa
 *   "nada mudou" de "mudou", e é o que torna o atalho seguro.
 *
 * Quando a listagem não traz status, `semStatusPula` decide. Na importação de
 * histórico vale pular — releitura de meses é o custo que o atalho existe para
 * evitar. Na sincronização incremental não vale: ali, aparecer na listagem por
 * `update_time` já é sinal de que o pedido mudou.
 */
export async function pedidosJaCompletos(
  marketplaceAccountId: string,
  externalOrderIds: string[],
  opcoes: { statusListado?: Map<string, OrderStatus | string>; semStatusPula?: boolean } = {},
): Promise<Set<string>> {
  if (externalOrderIds.length === 0) return new Set();

  const gravados = await prisma.order.findMany({
    where: {
      marketplaceAccountId,
      externalOrderId: { in: externalOrderIds },
      feesAreEstimated: false,
      items: { some: {} },
    },
    select: { externalOrderId: true, status: true },
  });

  const semStatusPula = opcoes.semStatusPula ?? true;
  const completos = new Set<string>();

  for (const g of gravados) {
    const listado = opcoes.statusListado?.get(g.externalOrderId);
    if (listado === undefined) {
      if (semStatusPula) completos.add(g.externalOrderId);
      continue;
    }
    if (listado === g.status) completos.add(g.externalOrderId);
  }

  return completos;
}
