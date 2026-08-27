import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { createProvider, encryptSecret } from "@mastershopee/integrations";
import { getIntegrationEnv } from "@/lib/integration-env";
import { SLUG_TO_MARKETPLACE } from "@/lib/marketplace-slug";
import { cookies } from "next/headers";
import { OAUTH_STATE_COOKIE, verifyOAuthState } from "@/lib/oauth-state";
import { captureError } from "@/lib/observability";
import { marketplaceSyncQueue } from "@/lib/queue";

/** OAuth callback (§33, §39). Verifies state, exchanges the code, encrypts tokens before they ever touch the DB. */
export async function GET(request: Request, { params }: { params: { marketplace: string } }) {
  const marketplace = SLUG_TO_MARKETPLACE[params.marketplace];
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // A Shopee acrescenta só `code` e `shop_id` ao redirect, então o state vai
  // embutido na própria URL de redirect; o cookie cobre o caso de o
  // marketplace descartar os parâmetros da URL registrada.
  const state = url.searchParams.get("state") ?? cookies().get(OAUTH_STATE_COOKIE)?.value ?? null;
  // A Shopee devolve o shop_id no redirect e exige o mesmo id no corpo da
  // troca do code por token. Sem repassar daqui, a troca é recusada, nada é
  // gravado, e a tela fica dizendo "nenhuma conta conectada" depois de uma
  // autorização que o vendedor viu dar certo do lado da Shopee.
  const shopId = url.searchParams.get("shop_id") ?? undefined;

  if (!marketplace || !code || !state) {
    return NextResponse.redirect(new URL("/integrations?error=invalid_callback", request.url));
  }

  const verified = verifyOAuthState(state, params.marketplace);
  if (!verified) {
    return NextResponse.redirect(new URL("/integrations?error=invalid_state", request.url));
  }

  // Guardado fora do try: se algo falhar depois de a conta existir, ela não
  // pode ficar parada em "Sincronizando" para sempre — a tela estaria
  // afirmando que há uma sincronização em andamento que não existe.
  let accountId: string | null = null;

  try {
    const provider = createProvider(marketplace, getIntegrationEnv());
    const token = await provider.exchangeAuthorizationCode(code, shopId);

    const account = await prisma.marketplaceAccount.upsert({
      where: {
        workspaceId_marketplace_externalShopId: {
          workspaceId: verified.workspaceId,
          marketplace,
          externalShopId: token.externalShopId,
        },
      },
      update: { status: "SYNCING", connectedAt: new Date(), disconnectedAt: null },
      create: {
        workspaceId: verified.workspaceId,
        marketplace,
        externalShopId: token.externalShopId,
        displayName: token.externalShopName ?? `${marketplace} — ${token.externalShopId}`,
        status: "SYNCING",
        connectedAt: new Date(),
      },
    });

    accountId = account.id;

    await prisma.marketplaceCredential.upsert({
      where: { marketplaceAccountId: account.id },
      update: {
        encryptedAccessToken: encryptSecret(token.accessToken),
        encryptedRefreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : undefined,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        scope: token.scope,
        rotatedAt: new Date(),
      },
      create: {
        marketplaceAccountId: account.id,
        encryptedAccessToken: encryptSecret(token.accessToken),
        encryptedRefreshToken: token.refreshToken ? encryptSecret(token.refreshToken) : undefined,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        scope: token.scope,
      },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: verified.workspaceId,
        action: "marketplace.connected",
        entityType: "MarketplaceAccount",
        entityId: account.id,
        metadata: { marketplace },
      },
    });

    await prisma.notification.create({
      data: {
        workspaceId: verified.workspaceId,
        title: "Nova integração realizada",
        body: `${account.displayName} foi conectada. A primeira sincronização começou.`,
      },
    });

    // Dispara a primeira sincronização (§82) — a página de Integrações
    // acompanha a IntegrationSync que esse job escreve.
    //
    // Sem Redis isto lança, e lançar aqui desfaria uma conexão que já deu
    // certo: a conta e as credenciais acima já estão gravadas, e existe a
    // sincronização manual que roda sem fila. Perder a conexão inteira por
    // causa do agendamento seria trocar um problema pequeno por um grande.
    let queued = true;
    try {
      await marketplaceSyncQueue.add("initial-full-sync", { marketplaceAccountId: account.id, type: "FULL" });
    } catch (queueErr) {
      queued = false;
      captureError(queueErr, { marketplace, workspaceId: verified.workspaceId, route: "integrations.callback.enqueue" });
      await prisma.notification.create({
        data: {
          workspaceId: verified.workspaceId,
          title: "Sincronização automática indisponível",
          body: "A conta foi conectada, mas a fila de sincronização não está configurada. Use \"Importar pedidos\" em Integrações para trazer os pedidos agora.",
        },
      });
    }

    return NextResponse.redirect(
      new URL(`/integrations?connected=1${queued ? "" : "&queue=unavailable"}`, request.url),
    );
  } catch (err) {
    captureError(err, { marketplace, workspaceId: verified.workspaceId, route: "integrations.callback" });

    // A mensagem real vai para a tela, não "falha ao conectar". As causas aqui
    // são de configuração — CREDENTIALS_ENCRYPTION_KEY ausente, por exemplo —
    // e um texto genérico transforma uma causa nomeada em tentativa às cegas.
    // Truncada porque nada garante o tamanho de um erro de biblioteca.
    const message = (err instanceof Error ? err.message : "Falha ao conectar com o marketplace.").slice(0, 300);

    if (accountId) {
      await prisma.marketplaceAccount.update({
        where: { id: accountId },
        data: { status: "ERROR", lastErrorMessage: message },
      });
    }

    return NextResponse.redirect(
      new URL(`/integrations?error=oauth_failed&message=${encodeURIComponent(message)}`, request.url),
    );
  }
}
