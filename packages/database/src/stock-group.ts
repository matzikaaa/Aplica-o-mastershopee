import { prisma } from "./index";
import { recordStockMovement } from "./stock";

/**
 * Agrupa SKUs que consomem o mesmo produto físico.
 *
 * O agrupamento muda onde a baixa acontece, então o saldo que os SKUs tinham
 * separados precisa ir junto — senão o número somado da prateleira muda
 * sozinho no momento em que alguém organiza o cadastro, e o operador perde a
 * confiança no estoque inteiro.
 *
 * A transferência é feita com movimentos de ajuste, um saindo e outro
 * entrando, e não editando saldos: assim ela aparece no extrato com a razão
 * escrita, em vez de ser uma mudança que ninguém consegue explicar depois.
 */
export interface MembroDoGrupo {
  productId: string;
  /** Quantas unidades-base uma venda deste SKU consome. */
  unitsPerSale: number;
}

export interface ResultadoAgrupamento {
  base: string;
  agrupados: number;
  unidadesTransferidas: number;
}

export async function agruparEstoque(
  workspaceId: string,
  baseProductId: string,
  membros: MembroDoGrupo[],
  userId?: string,
): Promise<ResultadoAgrupamento> {
  const base = await prisma.product.findFirst({
    where: { id: baseProductId, workspaceId },
    select: { id: true, sku: true, stockParentId: true },
  });
  if (!base) throw new Error("Produto-base não encontrado neste workspace.");

  // Um grupo de um nível só: apontar para um SKU que já é membro de outro
  // grupo criaria uma corrente em que a baixa teria que subir vários saltos,
  // e um ciclo acidental travaria a gravação de toda venda.
  if (base.stockParentId) {
    throw new Error("O produto-base escolhido já pertence a outro grupo de estoque.");
  }

  let agrupados = 0;
  let unidadesTransferidas = 0;

  for (const membro of membros) {
    if (membro.productId === baseProductId) continue;

    const unidades = Math.max(1, Math.trunc(membro.unitsPerSale));

    const produto = await prisma.product.findFirst({
      where: { id: membro.productId, workspaceId },
      select: { id: true, sku: true, stockItem: { select: { quantity: true } } },
    });
    if (!produto) continue;

    const saldo = produto.stockItem?.quantity ?? 0;
    if (saldo !== 0) {
      // O saldo do SKU está contado em embalagens; na base ele vale
      // `unidades` vezes mais.
      await recordStockMovement({
        workspaceId,
        productId: produto.id,
        type: "ADJUSTMENT",
        units: -saldo,
        note: `Estoque unificado em ${base.sku}`,
        createdByUserId: userId,
      });
      await recordStockMovement({
        workspaceId,
        productId: base.id,
        type: "ADJUSTMENT",
        units: saldo * unidades,
        note: `Saldo recebido de ${produto.sku} (${saldo} × ${unidades})`,
        createdByUserId: userId,
      });
      unidadesTransferidas += saldo * unidades;
    }

    await prisma.product.update({
      where: { id: produto.id },
      data: { stockParentId: base.id, unitsPerSale: unidades },
    });
    agrupados++;
  }

  return { base: base.sku, agrupados, unidadesTransferidas };
}

/** Desfaz o agrupamento de um SKU, devolvendo-o a estoque próprio (zerado). */
export async function desagruparEstoque(workspaceId: string, productId: string): Promise<void> {
  const produto = await prisma.product.findFirst({
    where: { id: productId, workspaceId },
    select: { id: true },
  });
  if (!produto) throw new Error("Produto não encontrado neste workspace.");

  // O saldo não volta junto: ele foi consumido como unidades-base e não há
  // como saber quanto da prateleira pertencia a este SKU. Voltar zerado é
  // verdade; repartir por um palpite não seria.
  await prisma.product.update({
    where: { id: produto.id },
    data: { stockParentId: null, unitsPerSale: 1 },
  });
}
