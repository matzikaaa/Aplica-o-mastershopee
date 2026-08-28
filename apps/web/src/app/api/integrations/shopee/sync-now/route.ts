import { NextResponse } from "next/server";
import {
  prisma,
  recomputeMetricsForDays,
  resolveFreshCredentials,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import { ShopeeProvider, decryptSecret, encryptSecret } from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { resolveShopeeAccount } from "@/lib/shopee-account";
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
// Abaixo de maxDuration com folga: estourar o teto da plataforma mata a
// função sem resposta, e aí o cursor do lote em andamento se perde.
const BUDGET_MS = 40_000;

/**
 * Fatia do orçamento reservada ao catálogo. O objetivo do vendedor é ver os
 * SKUs para preencher custo, então o catálogo vem primeiro — mas com teto:
 * um catálogo grande não pode consumir a requisição inteira e deixar os
 * pedidos de fora.
 */
const CATALOG_BUDGET_MS = 12_000;

export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();

  const account = await resolveShopeeAccount(workspace.id);
  if ("error" in account) {
    return NextResponse.json({ error: account.error }, { status: account.status });
  }

  const body = (await request.json().catch(() => ({}))) as { days?: number; restart?: boolean };
  // A Shopee só consulta 15 dias por chamada; o cursor guarda em que janela
  // parou e vai andando até alcançar o presente. Pedir 120 dias não é uma
  // requisição gigante — são várias, retomadas a cada clique.
  const days = Math.min(Math.max(body.days ?? 120, 1), 365);

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  // O token da Shopee vale 4 horas. Sem renovar aqui, a importação passa a
  // falhar com "invalid_access_token" algumas horas depois de conectar.
  let credentials;
  try {
    credentials = await resolveFreshCredentials({
      accountId: account.id,
      externalShopId: account.externalShopId,
      provider,
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao renovar o acesso à Shopee." },
      { status: 409 },
    );
  }

  // Retomar de onde parou é o padrão; `restart` reabre a janela inteira, para
  // quando um mapeamento foi corrigido e os pedidos precisam ser regravados.
  let cursor = { value: body.restart ? null : account.lastSyncCursor };
  const from = new Date(Date.now() - days * 24 * 3600 * 1000);

  const startedAt = Date.now();
  let ordersWritten = 0;
  let ordersWithoutConfirmedFees = 0;
  let hasMore = true;
  const touchedDays = new Set<string>();

  try {
    // ── Pedidos ────────────────────────────────────────────────────────
    while (hasMore && Date.now() - startedAt < BUDGET_MS) {
      const page = await provider.fetchOrders(credentials, cursor, from);

      let completou = true;
      for (const order of page.items) {
        if (Date.now() - startedAt > BUDGET_MS) {
          // Estourou no meio da página: não avança o cursor. O próximo clique
          // refaz esta página inteira, e refazer é inofensivo porque a
          // gravação é idempotente — enquanto perder o cursor faria recomeçar
          // do início de tudo.
          completou = false;
          break;
        }
        await upsertNormalizedOrder(account, order);
        ordersWritten++;
        if (order.feesFromEscrow === false) ordersWithoutConfirmedFees++;
        touchedDays.add(order.orderedAt.toISOString().slice(0, 10));
      }

      if (!completou) break;

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
    productsWithoutCost,
    ordersWritten,
    ordersWithoutConfirmedFees,
    hasMore,
    elapsedMs: Date.now() - startedAt,
  });
}
