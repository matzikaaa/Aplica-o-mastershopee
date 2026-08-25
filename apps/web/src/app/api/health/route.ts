import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { getRedisUrl } from "@/lib/redis-url";

export const dynamic = "force-dynamic";

/**
 * Says whether this deployment can actually do its job, and if not, which
 * piece is missing.
 *
 * Exists because the two most common deployment faults are invisible from the
 * outside and produce the *same* symptom: "e-mail ou senha incorretos" on a
 * correct password. Either the database is unreachable (the user lookup
 * throws, and the credentials provider can only answer "no"), or NEXTAUTH_URL
 * disagrees with the origin the browser is using (CSRF validation fails
 * before the password is ever checked). Guessing between them costs a redeploy
 * per attempt.
 *
 * Reports presence and shape, never values: a boolean for each secret, the
 * configured public origin (which is public by definition), and a Prisma
 * error code. No connection string, key or password passes through here.
 */
export async function GET(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const configuredUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "") ?? null;

  const database = await checkDatabase();

  // The mismatch that breaks login while looking like a wrong password.
  const authUrlMatchesOrigin = configuredUrl === null ? null : configuredUrl === requestOrigin;

  const problems: string[] = [];
  if (!database.ok) {
    problems.push(
      `Banco inacessível (${database.code}). Confira DATABASE_URL na Vercel — use a string com "-pooler" e verifique se a senha real substituiu o placeholder.`,
    );
  }
  if (configuredUrl === null) {
    problems.push("NEXTAUTH_URL não configurado. Sem ele o login recusa senhas corretas dizendo que estão erradas.");
  } else if (authUrlMatchesOrigin === false) {
    problems.push(
      `NEXTAUTH_URL (${configuredUrl}) é diferente da origem desta requisição (${requestOrigin}). O login vai falhar a validação de CSRF e reportar isso como senha incorreta.`,
    );
  }
  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    problems.push("AUTH_SECRET não configurado — sessões não podem ser assinadas.");
  }
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    problems.push("CREDENTIALS_ENCRYPTION_KEY não configurado — credenciais de marketplace não podem ser cifradas.");
  }

  const body = {
    ok: problems.length === 0,
    problems,
    database,
    auth: {
      configuredUrl,
      requestOrigin,
      matchesOrigin: authUrlMatchesOrigin,
      hasSecret: Boolean(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
      hasCredentialsKey: Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY),
    },
    // Optional pieces: absent is a documented, working state, not a fault.
    optional: {
      redis: getRedisUrl() ? "configurado" : "ausente (login sem limite de tentativas)",
      shopee: process.env.SHOPEE_PARTNER_ID ? `configurado (${process.env.SHOPEE_ENV ?? "live"})` : "ausente",
      whatsapp: process.env.WHATSAPP_ACCESS_TOKEN ? "configurado" : "ausente",
    },
  };

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

async function checkDatabase(): Promise<{ ok: boolean; code: string; plans: number | null }> {
  try {
    // Counting plans proves the connection *and* that the migrations and the
    // plan seed actually ran — an empty catalogue means every login lands in
    // a workspace with no subscription to check.
    const plans = await prisma.plan.count();
    return { ok: true, code: "ok", plans };
  } catch (err) {
    const code = (err as { errorCode?: string; code?: string }).errorCode ?? (err as { code?: string }).code ?? "unknown";
    return { ok: false, code: String(code), plans: null };
  }
}
