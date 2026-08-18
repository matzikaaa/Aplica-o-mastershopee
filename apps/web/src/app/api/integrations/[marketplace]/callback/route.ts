import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { createProvider, encryptSecret, MarketplaceApiError } from "@mastershopee/integrations";
import { getIntegrationEnv } from "@/lib/integration-env";
import { SLUG_TO_MARKETPLACE } from "@/lib/marketplace-slug";
import { verifyOAuthState } from "@/lib/oauth-state";
import { captureError } from "@/lib/observability";

/** OAuth callback (§33, §39). Verifies state, exchanges the code, encrypts tokens before they ever touch the DB. */
export async function GET(request: Request, { params }: { params: { marketplace: string } }) {
  const marketplace = SLUG_TO_MARKETPLACE[params.marketplace];
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!marketplace || !code || !state) {
    return NextResponse.redirect(new URL("/integrations?error=invalid_callback", request.url));
  }

  const verified = verifyOAuthState(state, params.marketplace);
  if (!verified) {
    return NextResponse.redirect(new URL("/integrations?error=invalid_state", request.url));
  }

  try {
    const provider = createProvider(marketplace, getIntegrationEnv());
    const token = await provider.exchangeAuthorizationCode(code);

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

    // TODO(worker): enqueue an initial FULL sync job for `account.id` here once
    // apps/worker's queue client is wired into the web app (§82 — first sync progress).

    return NextResponse.redirect(new URL("/integrations?connected=1", request.url));
  } catch (err) {
    captureError(err, { marketplace, workspaceId: verified.workspaceId, route: "integrations.callback" });
    const message = err instanceof MarketplaceApiError ? err.message : "Falha ao conectar com o marketplace.";
    return NextResponse.redirect(new URL(`/integrations?error=oauth_failed&message=${encodeURIComponent(message)}`, request.url));
  }
}
