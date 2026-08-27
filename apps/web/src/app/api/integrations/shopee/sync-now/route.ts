import { NextResponse } from "next/server";
import {
  prisma,
  recomputeMetricsForDays,
  upsertMarketplaceProduct,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import { ShopeeProvider, decryptSecret } from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { getIntegrationEnv } from "@/lib/integration-env";

/**
 * Sincroniza os pedidos da Shopee dentro da própria requisição.
 *
 * O caminho normal é a fila: "Sincronizar agora" enfileira um job no BullMQ e
 * o worker consome. Só que o worker não está hospedado, e sem Redis o job não
 * tem quem o execute — o vendedor clica, nada acontece, e não há erro para
 * mostrar. Esta rota fecha esse buraco: mesma gravação
 * (`upsertNormalizedOrder`, compartilhada com o worker), sem infraestrutura
 * adicional.
 *
 * O preço é o teto de tempo da função serverless. Por isso ela trabalha por
 * orçamento: pagina enquanto houver tempo, grava o cursor de onde parou e
 * devolve `hasMore` para o vendedor continuar. Uma sincronização parcial que
 * diz onde parou é honesta; uma que estoura no meio e perde o cursor faz o
 * próximo clique recomeçar do zero.
 */
export const maxDuration = 60;

/** Margem para gravar cursor e métricas depois do último lote. */
const BUDGET_MS = 45_000;

/**
 * Fatia do orçamento reservada ao catálogo. O objetivo do vendedor é ver os
 * SKUs para preencher custo, então o catálogo vem primeiro — mas com teto:
 * um catálogo grande não pode consumir a requisição inteira e deixar os
 * pedidos de fora.
 */
const CATALOG_BUDGET_MS = 15_000;

export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();

  const account = await prisma.marketplaceAccount.findFirst({
    where: { workspaceId: workspace.id, marketplace: "SHOPEE" },
    include: { credential: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Nenhuma conta Shopee conectada neste workspace." }, { status: 404 });
  }
  if (!account.credential) {
    return NextResponse.json(
      { error: "A conta Shopee existe, mas está sem token salvo — a autorização não foi concluída. Conecte novamente." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { days?: number; restart?: boolean };
  const days = Math.min(Math.max(body.days ?? 30, 1), 365);

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  const credentials = {
    accessToken: decryptSecret(account.credential.encryptedAccessToken),
    refreshToken: account.credential.encryptedRefreshToken
      ? decryptSecret(account.credential.encryptedRefreshToken)
      : undefined,
    externalShopId: account.externalShopId,
  };

  // Retomar de onde parou é o padrão; `restart` reabre a janela inteira, para
  // quando um mapeamento foi corrigido e os pedidos precisam ser regravados.
  let cursor = { value: body.restart ? null : account.lastSyncCursor };
  const from = new Date(Date.now() - days * 24 * 3600 * 1000);

  const startedAt = Date.now();
  let productsWritten = 0;
  let ordersWritten = 0;
  let ordersWithoutConfirmedFees = 0;
  let hasMore = true;
  const touchedDays = new Set<string>();

  try {
    // ── Catálogo ───────────────────────────────────────────────────────
    // Sem esta passada, só apareceriam os SKUs que venderam na janela. O
    // vendedor precisa da lista inteira para cadastrar custo antes de a
    // próxima venda acontecer.
    let productCursor = { value: null as string | null };
    let hasMoreProducts = true;
    while (hasMoreProducts && Date.now() - startedAt < CATALOG_BUDGET_MS) {
      const page = await provider.fetchProducts(credentials, productCursor);
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
      productCursor = page.nextCursor;
      hasMoreProducts = page.hasMore;
    }

    // ── Pedidos ────────────────────────────────────────────────────────
    while (hasMore && Date.now() - startedAt < BUDGET_MS) {
      const page = await provider.fetchOrders(credentials, cursor, from);

      for (const order of page.items) {
        await upsertNormalizedOrder(account, order);
        ordersWritten++;
        if (order.feesFromEscrow === false) ordersWithoutConfirmedFees++;
        touchedDays.add(order.orderedAt.toISOString().slice(0, 10));
      }

      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }
  } catch (err) {
    // Grava o que já entrou antes de reportar: perder o cursor faria o
    // próximo clique repetir todo o trabalho já feito.
    await prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: { lastSyncCursor: cursor.value, lastErrorMessage: err instanceof Error ? err.message : "erro" },
    });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Falha ao consultar a Shopee.",
        productsWritten,
        ordersWritten,
      },
      { status: 502 },
    );
  }

  if (touchedDays.size > 0) {
    await recomputeMetricsForDays(workspace.id, [...touchedDays]);
  }

  await prisma.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      status: "CONNECTED",
      lastSyncAt: new Date(),
      lastSyncCursor: cursor.value,
      lastErrorMessage: null,
    },
  });

  const productsWithoutCost = await prisma.product.count({
    where: { workspaceId: workspace.id, costs: { none: {} } },
  });

  return NextResponse.json({
    ok: true,
    productsWritten,
    productsWithoutCost,
    ordersWritten,
    ordersWithoutConfirmedFees,
    hasMore,
    elapsedMs: Date.now() - startedAt,
  });
}
