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
  if (!database.configured) {
    problems.push("DATABASE_URL não está configurado neste ambiente. Adicione a connection string do Neon (a com \"-pooler\") e faça um novo deploy.");
  } else if (!database.ok) {
    problems.push(
      `Banco inacessível (${database.code}). ${database.detail ?? ""}`.trim() +
        (database.pooled === false
          ? ' O host não tem "-pooler": para funções serverless use a string pooled.'
          : ""),
    );
  } else if (database.plans === 0) {
    problems.push("Banco conectado, mas sem catálogo de planos — falta rodar prisma/seed.ts.");
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
  if (!process.env.EMAIL_SERVER_HOST) {
    problems.push(
      "EMAIL_SERVER_HOST não configurado — verificação de conta e recuperação de senha não são entregues a ninguém.",
    );
  }
  const credentialsKey = describeCredentialsKey();
  if (credentialsKey !== "ok") {
    problems.push(
      `CREDENTIALS_ENCRYPTION_KEY ${credentialsKey}. Gere com \`openssl rand -base64 32\` e configure na Vercel — sem isso, conectar um marketplace cria a conta e falha ao salvar o token.`,
    );
  }

  const body = {
    ok: problems.length === 0,
    problems,
    database,
    email: process.env.EMAIL_SERVER_HOST ? "configurado" : "ausente",
    auth: {
      configuredUrl,
      requestOrigin,
      matchesOrigin: authUrlMatchesOrigin,
      hasSecret: Boolean(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
      credentialsKey,
    },
    // Optional pieces: absent is a documented, working state, not a fault.
    optional: {
      redis: getRedisUrl() ? "configurado" : "ausente (login sem limite de tentativas)",
      shopee: process.env.SHOPEE_PARTNER_ID
        ? `configurado (${process.env.SHOPEE_ENV ?? "live"}, chave lida como "${process.env.SHOPEE_KEY_ENCODING ?? "raw"}")`
        : "ausente",
      whatsapp: process.env.WHATSAPP_ACCESS_TOKEN ? "configurado" : "ausente",
      cron: process.env.CRON_SECRET ? "configurado" : "ausente (relatório diário não dispara sozinho)",
    },
  };

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

/**
 * Sem esta chave nenhum token de marketplace pode ser gravado: `encryptSecret`
 * lança, e a conexão morre logo depois de criar a conta — deixando a tela
 * dizendo "Sincronizando" para uma conta sem token. Reportar só "presente"
 * não bastava: uma chave com tamanho errado falha do mesmo jeito e parece
 * configurada. O tamanho em bytes é seguro de mostrar; o valor nunca.
 */
function describeCredentialsKey(): string {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) return "ausente — impossível conectar marketplaces";
  const bytes = Buffer.from(raw, "base64").length;
  return bytes === 32 ? "ok" : `tamanho inválido: ${bytes} bytes, precisa 32`;
}

interface DatabaseCheck {
  ok: boolean;
  code: string;
  plans: number | null;
  /** Whether DATABASE_URL exists at all — "unset" and "wrong" look identical otherwise. */
  configured: boolean;
  /** Host only, so pooled-vs-direct is visible. Never the user or password. */
  host: string | null;
  pooled: boolean | null;
  detail: string | null;
}

async function checkDatabase(): Promise<DatabaseCheck> {
  const raw = process.env.DATABASE_URL?.trim();
  let host: string | null = null;
  try {
    if (raw) host = new URL(raw).hostname;
  } catch {
    host = "não foi possível ler a URL";
  }

  const base = {
    configured: Boolean(raw),
    host,
    pooled: host ? host.includes("-pooler") : null,
  };

  try {
    // Counting plans proves the connection *and* that the migrations and the
    // plan seed actually ran — an empty catalogue means every login lands in
    // a workspace with no subscription to check.
    const plans = await prisma.plan.count();
    return { ...base, ok: true, code: "ok", plans, detail: null };
  } catch (err) {
    const code = (err as { errorCode?: string; code?: string }).errorCode ?? (err as { code?: string }).code ?? "unknown";
    return { ...base, ok: false, code: String(code), plans: null, detail: sanitize(err) };
  }
}

/**
 * Prisma's own message names the fault far better than any wrapper could
 * ("Environment variable not found", "Authentication failed"), so it is worth
 * surfacing — with any embedded credentials scrubbed first, since connection
 * strings do appear in some of these messages.
 */
function sanitize(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/:\/\/[^@\s]+@/g, "://[credenciais]@")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 300);
}
