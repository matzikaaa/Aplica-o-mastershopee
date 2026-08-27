import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { ShopeeProvider, decryptSecret } from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { getIntegrationEnv } from "@/lib/integration-env";

/**
 * Puxa pedidos reais da Shopee e devolve o que ela mandou ao lado do que a
 * aplicação calculou — **sem gravar nada**.
 *
 * O mapeamento dos campos financeiros da Shopee (o que é comissão, o que é
 * taxa de serviço, quanto do frete sai do bolso do vendedor) foi escrito
 * contra a documentação, não contra dados reais desta loja. Sincronizar
 * direto significaria descobrir um erro de mapeamento só depois de ele já
 * ter virado "lucro" no dashboard.
 *
 * Aqui o vendedor compara os números com o extrato da própria Shopee antes de
 * qualquer coisa entrar no banco. É a diferença entre confiar no mapeamento e
 * conferir o mapeamento.
 */
export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();

  const account = await prisma.marketplaceAccount.findFirst({
    where: { workspaceId: workspace.id, marketplace: "SHOPEE" },
    include: { credential: true },
  });

  if (!account?.credential) {
    return NextResponse.json(
      { error: "Nenhuma conta Shopee conectada neste workspace." },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { days?: number };
  // A Shopee limita a consulta a 15 dias por chamada.
  const days = Math.min(Math.max(body.days ?? 7, 1), 15);

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  try {
    const page = await provider.fetchOrders(
      {
        accessToken: decryptSecret(account.credential.encryptedAccessToken),
        refreshToken: account.credential.encryptedRefreshToken
          ? decryptSecret(account.credential.encryptedRefreshToken)
          : undefined,
        externalShopId: account.externalShopId,
      },
      { value: null },
      new Date(Date.now() - days * 24 * 3600 * 1000),
    );

    const withoutFees = page.items.filter((o) => o.feesFromEscrow === false).length;

    return NextResponse.json({
      ok: true,
      windowDays: days,
      orderCount: page.items.length,
      // Um pedido sem escrow entra com taxa zero, o que infla o lucro. Contar
      // isso aqui é o que impede a prévia de parecer melhor do que é.
      ordersWithoutConfirmedFees: withoutFees,
      hasMore: page.hasMore,
      orders: page.items.map((o) => ({
        externalOrderId: o.externalOrderId,
        status: o.status,
        orderedAt: o.orderedAt,
        currency: o.currency,
        feesFromEscrow: o.feesFromEscrow ?? false,
        calculado: {
          grossAmount: o.grossAmount,
          discountAmount: o.discountAmount,
          shippingChargedToBuyer: o.shippingChargedToBuyer,
          shippingSubsidizedByMerchant: o.shippingSubsidizedByMerchant,
          commissionAmount: o.commissionAmount,
          marketplaceFeeAmount: o.marketplaceFeeAmount,
        },
        itens: o.items.map((i) => ({
          sku: i.externalSku,
          title: i.title,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        // O payload cru da Shopee, para conferir campo a campo contra o que
        // foi calculado acima.
        shopee: o.raw,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao consultar a Shopee." },
      { status: 502 },
    );
  }
}
