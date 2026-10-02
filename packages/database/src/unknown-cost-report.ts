import { prisma } from "./index";
import { unknownCostWhere } from "./order-status";

/**
 * Quais SKUs estão por trás das vendas sem custo conhecido — com o motivo.
 *
 * Contar e não nomear transformava o aviso num enigma: "3 itens sem custo"
 * numa tela em que todos os produtos visíveis mostram custo preenchido não
 * diz o que fazer, e sem ação possível o aviso vira ruído que se aprende a
 * ignorar. Um número só é acionável quando vem com o nome.
 *
 * O motivo vem junto porque os dois casos têm consertos diferentes: produto
 * sem nenhum custo cadastrado se resolve cadastrando; produto com custo
 * vigente depois da venda se resolve aplicando ao histórico.
 */
export interface VendaSemCusto {
  productId: string;
  sku: string;
  nome: string;
  /** Quantos itens vendidos deste SKU estão sem custo. */
  itens: number;
  /** A venda mais antiga sem custo — é a data que o custo precisa alcançar. */
  primeiraVenda: Date;
  /** Início de vigência do custo mais antigo, ou null se não há custo. */
  custoDesde: Date | null;
  motivo: "sem-custo-cadastrado" | "custo-comeca-depois-da-venda";
}

export async function vendasSemCusto(workspaceId: string): Promise<VendaSemCusto[]> {
  const itens = await prisma.orderItem.findMany({
    where: { order: { workspaceId }, ...unknownCostWhere() },
    select: {
      productId: true,
      externalSku: true,
      title: true,
      order: { select: { orderedAt: true } },
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          costs: { orderBy: { effectiveFrom: "asc" }, take: 1, select: { effectiveFrom: true } },
        },
      },
    },
    // Teto: a lista existe para ser lida e agida, e um relatório com milhares
    // de linhas não é nenhum dos dois. Quem tem tanto assim está no caso de
    // importar custos em massa, não de conferir SKU a SKU.
    take: 2000,
  });

  const porProduto = new Map<string, VendaSemCusto>();

  for (const item of itens) {
    // Item sem produto é um SKU que a Shopee devolveu em branco: não há
    // cadastro onde pendurar um custo. Agrupado pelo SKU bruto para aparecer
    // na lista do mesmo jeito, em vez de sumir da contagem.
    const chave = item.product?.id ?? `sku:${item.externalSku}`;
    const existente = porProduto.get(chave);

    if (existente) {
      existente.itens += 1;
      if (item.order.orderedAt < existente.primeiraVenda) existente.primeiraVenda = item.order.orderedAt;
      continue;
    }

    const custoDesde = item.product?.costs[0]?.effectiveFrom ?? null;
    porProduto.set(chave, {
      productId: item.product?.id ?? "",
      sku: item.product?.sku ?? item.externalSku,
      nome: item.product?.name ?? item.title,
      itens: 1,
      primeiraVenda: item.order.orderedAt,
      custoDesde,
      motivo: custoDesde ? "custo-comeca-depois-da-venda" : "sem-custo-cadastrado",
    });
  }

  return [...porProduto.values()].sort((a, b) => b.itens - a.itens);
}
