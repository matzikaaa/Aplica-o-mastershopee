import { createHmac, randomBytes } from "node:crypto";

/**
 * Cookie de reserva para o `state`.
 *
 * O caminho principal é o `state` embutido na URL de redirect. Nem todo
 * marketplace preserva parâmetros ali — a Shopee só acrescenta `code` e
 * `shop_id` —, e uma volta perdida custa ao vendedor um deploy inteiro para
 * descobrir. SameSite=Lax é o que faz o cookie sobreviver: a volta do
 * marketplace é uma navegação GET de topo vindo de outro site, exatamente o
 * caso que Lax permite.
 */
export const OAUTH_STATE_COOKIE = "ms_oauth_state";

export const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 10 * 60,
};

/**
 * Stateless, signed OAuth `state` parameter — binds the callback back to
 * the workspace that initiated the connection and guards against CSRF,
 * without needing a server-side session store for the OAuth round trip.
 */
export function createOAuthState(workspaceId: string, marketplace: string): string {
  const nonce = randomBytes(8).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ workspaceId, marketplace, nonce, expiresAt })).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string, marketplace: string): { workspaceId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      workspaceId: string;
      marketplace: string;
      expiresAt: number;
    };
    if (data.marketplace !== marketplace) return null;
    if (data.expiresAt < Date.now()) return null;
    return { workspaceId: data.workspaceId };
  } catch {
    return null;
  }
}

function sign(payload: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Never fall back to a hardcoded secret here: this HMAC is what stops an
    // attacker from forging a `state` that binds their own OAuth connection
    // to a victim's workspaceId (§8 multi-tenant isolation). A silent weak
    // default would be worse than crashing loudly on misconfiguration.
    throw new Error("AUTH_SECRET must be set to sign/verify OAuth state — refusing to use a weak default.");
  }
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}
