import { prisma } from "./index";

/**
 * Quais destes pedidos já estão gravados e não precisam ser buscados de novo.
 *
 * "Completo" aqui é o pedido que já tem taxa confirmada pela Shopee
 * (`feesAreEstimated: false`) e pelo menos um item. Pedido com taxa estimada
 * fica de fora de propósito: o escrow dele ainda não estava liberado quando
 * foi importado, e é justamente esse que vale reconsultar — a próxima rodada
 * pode fechar o valor real.
 *
 * Existe para a importação perguntar *antes* de gastar: descrever um pedido
 * custa uma chamada de escrow só para ele, e sem esta consulta reimportar um
 * histórico já baixado custava o mesmo que baixá-lo pela primeira vez.
 */
export async function pedidosJaCompletos(
  marketplaceAccountId: string,
  externalOrderIds: string[],
): Promise<Set<string>> {
  if (externalOrderIds.length === 0) return new Set();

  const gravados = await prisma.order.findMany({
    where: {
      marketplaceAccountId,
      externalOrderId: { in: externalOrderIds },
      feesAreEstimated: false,
      items: { some: {} },
    },
    select: { externalOrderId: true },
  });

  return new Set(gravados.map((o) => o.externalOrderId));
}
