import { NextResponse } from "next/server";
import { createProvider, isProviderConfigured } from "@mastershopee/integrations";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { getIntegrationEnv } from "@/lib/integration-env";
import { SLUG_TO_MARKETPLACE } from "@/lib/marketplace-slug";
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_OPTIONS } from "@/lib/oauth-state";

/** Kicks off OAuth (§33 "Conectar"). Enforces plan limits *before* redirecting to the marketplace (§29). */
export async function GET(request: Request, { params }: { params: { marketplace: string } }) {
  const { workspace } = await requireWorkspace();
  const marketplace = SLUG_TO_MARKETPLACE[params.marketplace];
  if (!marketplace) {
    return NextResponse.json({ error: "Marketplace desconhecido." }, { status: 404 });
  }

  const env = getIntegrationEnv();
  if (!isProviderConfigured(marketplace, env)) {
    const url = new URL("/integrations", request.url);
    url.searchParams.set("error", "not_configured");
    url.searchParams.set("marketplace", params.marketplace);
    return NextResponse.redirect(url);
  }

  const permissions = await getPlanPermissionService(workspace.id);
  const gate = permissions.canConnectMarketplace(marketplace);
  if (!gate.allowed) {
    const url = new URL("/integrations", request.url);
    url.searchParams.set("error", "plan_limit");
    url.searchParams.set("reason", gate.reason ?? "");
    return NextResponse.redirect(url);
  }

  const provider = createProvider(marketplace, env);
  const state = createOAuthState(workspace.id, params.marketplace);

  const response = NextResponse.redirect(provider.getAuthorizationUrl(state));
  // Reserva: se o marketplace não devolver o state na volta, o callback ainda
  // consegue provar de qual workspace a autorização partiu.
  response.cookies.set(OAUTH_STATE_COOKIE, state, OAUTH_STATE_COOKIE_OPTIONS);
  return response;
}
