import { prisma } from "./index";

/**
 * Cadastro de produto vindo do marketplace.
 *
 * Duas portas de entrada, e as duas precisam existir. A sincronização de
 * catálogo traz os anúncios com nome e imagem — inclusive os que não
 * venderam. E cada item de pedido cadastra o SKU que vendeu, para o caso de
 * um anúncio pausado ou removido do catálogo: sem isso, uma venda de um SKU
 * fora do catálogo entra sem produto, fica sem custo, e não aparece em lugar
 * nenhum para o vendedor descobrir que falta preencher.
 *
 * Nenhuma das duas inventa custo. O produto nasce sem ProductCost, e o
 * painel mostra "sem custo" em vez de tratar como se fosse de graça (§96).
 */
export interface UpsertProductInput {
  sku: string;
  title: string;
  imageUrl?: string;
  externalProductId?: string;
  externalVariationId?: string;
}

export async function upsertMarketplaceProduct(
  account: { id: string; workspaceId: string },
  p: UpsertProductInput,
): Promise<string> {
  const product = await prisma.product.upsert({
    where: { workspaceId_sku: { workspaceId: account.workspaceId, sku: p.sku } },
    update: { name: p.title, imageUrl: p.imageUrl },
    create: { workspaceId: account.workspaceId, sku: p.sku, name: p.title, imageUrl: p.imageUrl },
  });

  if (p.externalProductId) {
    await prisma.marketplaceProduct.upsert({
      where: {
        marketplaceAccountId_externalProductId_externalVariationId: {
          marketplaceAccountId: account.id,
          externalProductId: p.externalProductId,
          externalVariationId: p.externalVariationId ?? "",
        },
      },
      update: { title: p.title },
      create: {
        productId: product.id,
        marketplaceAccountId: account.id,
        externalProductId: p.externalProductId,
        externalVariationId: p.externalVariationId ?? "",
        title: p.title,
      },
    });
  }

  return product.id;
}

/**
 * Cria o produto de um item de pedido só quando ele ainda não existe.
 *
 * Diferente do upsert de catálogo, este **não** sobrescreve o nome: o título
 * que vem no pedido é o do anúncio no momento da venda, e sobrepor com ele
 * apagaria o nome melhor que a sincronização de catálogo trouxe.
 */
export async function ensureProductForOrderItem(
  workspaceId: string,
  sku: string,
  title: string,
): Promise<string | null> {
  if (!sku.trim()) return null;

  // Um upsert com `update` vazio, não findUnique + create: é uma ida ao banco
  // em vez de duas, e numa importação de dezenas de pedidos essas idas são o
  // que decide se a requisição cabe no tempo da função.
  const product = await prisma.product.upsert({
    where: { workspaceId_sku: { workspaceId, sku } },
    update: {},
    create: { workspaceId, sku, name: title || sku },
  });
  return product.id;
}
