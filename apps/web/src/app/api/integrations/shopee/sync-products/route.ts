import { NextResponse } from "next/server";
import { prisma, resolveFreshCredentials, upsertMarketplaceProduct } from "@mastershopee/database";
import { ShopeeProvider, decryptSecret, encryptSecret } from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { getIntegrationEnv } from "@/lib/integration-env";
import { resolveShopeeAccount } from "@/lib/shopee-account";

/**
 * Traz o catálogo da Shopee — os SKUs — sem tocar em pedidos.
 *
 * Estava junto da importação de pedidos e as duas somadas não cabiam no
 * tempo de uma função serverless: o catálogo pede uma chamada de variações
 * por anúncio, e cada pedido pede uma de escrow mais várias gravações.
 *
 * Separar também segue a ordem em que o vendedor trabalha: primeiro os SKUs
 * aparecem para ele cadastrar os custos, depois os pedidos entram e o lucro
 * já nasce calculado. Importar pedidos antes dos custos produz um painel
 * cheio de "sem custo".
 */
export const maxDuration = 60;

const BUDGET_MS = 40_000;

export async function POST() {
  const { workspace } = await requireWorkspace();

  const account = await resolveShopeeAccount(workspace.id);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  const startedAt = Date.now();
  let productsWritten = 0;

  try {
    const credentials = await resolveFreshCredentials({
      accountId: account.id,
      externalShopId: account.externalShopId,
      provider,
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    });

    let cursor = { value: null as string | null };
    let hasMore = true;
    while (hasMore && Date.now() - startedAt < BUDGET_MS) {
      const page = await provider.fetchProducts(credentials, cursor);
      for (const product of page.items) {
        await upsertMarketplaceProduct(account, {
          sku: product.sku,
          title: product.title,
          imageUrl: product.imageUrl,
          externalProductId: product.externalProductId,
          externalVariationId: product.externalVariationId,
        });
        productsWritten++;
      }
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }

    const productsWithoutCost = await prisma.product.count({
      where: { workspaceId: workspace.id, costs: { none: {} } },
    });

    return NextResponse.json({ ok: true, productsWritten, productsWithoutCost, hasMore });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao consultar a Shopee.", productsWritten },
      { status: 502 },
    );
  }
}
