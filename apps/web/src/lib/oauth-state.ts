import { createHmac, randomBytes } from "node:crypto";

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
  const secret = process.env.AUTH_SECRET ?? "dev-secret-change-me";
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}
