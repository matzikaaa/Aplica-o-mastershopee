import { NextResponse } from "next/server";
import { prisma, resolveFreshCredentials } from "@mastershopee/database";
import { ShopeeProvider, decryptSecret, encryptSecret } from "@mastershopee/integrations";
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
/**
 * Achata `order_income` em pares nome/valor numéricos, na ordem em que a
 * Shopee mandou. Só números: é o que responde "de onde saiu esse valor" e o
 * que evita despejar texto na tela de conferência.
 */
function flattenNumbers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") out[key] = v;
  }
  return out;
}

export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();

  // Uma tentativa de conexão que falhou deixa uma conta órfã para trás, e
  // `findFirst` sem ordem pega qualquer uma. A que interessa é a que tem
  // token e foi conectada por último — escolher a errada faria a importação
  // falhar por "sem token" com a conta boa ali do lado.
  const account = await prisma.marketplaceAccount.findFirst({
    where: {
      workspaceId: workspace.id,
      marketplace: "SHOPEE",
      status: { not: "DISCONNECTED" },
      credential: { isNot: null },
    },
    include: { credential: true },
    orderBy: [{ connectedAt: "desc" }, { createdAt: "desc" }],
  });

  // Duas falhas diferentes: nunca conectou, ou conectou e o token não ficou
  // gravado. A segunda parece a primeira na tela e manda o vendedor repetir
  // uma autorização que já deu certo.
  if (!account) {
    return NextResponse.json({ error: "Nenhuma conta Shopee conectada neste workspace." }, { status: 404 });
  }
  if (!account.credential) {
    return NextResponse.json(
      { error: "A conta Shopee existe, mas está sem token salvo — a autorização não foi concluída. Conecte novamente." },
      { status: 409 },
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
      await resolveFreshCredentials({
        accountId: account.id,
        externalShopId: account.externalShopId,
        provider,
        encrypt: encryptSecret,
        decrypt: decryptSecret,
      }),
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
        // Os campos financeiros da Shopee em lista plana, além do payload
        // inteiro. Comparar o cálculo com o JSON cru exige achar a chave no
        // meio de tudo; aqui os números ficam lado a lado com o que foi
        // calculado, que é o que a conferência precisa.
        camposShopee: flattenNumbers((o.raw as { escrow?: { order_income?: unknown } })?.escrow?.order_income),
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
