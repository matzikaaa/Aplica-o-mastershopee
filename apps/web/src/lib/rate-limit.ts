import IORedis from "ioredis";
import { hitRateLimit } from "@mastershopee/database";
import { getRedisUrl } from "./redis-url";

/**
 * Fixed-window rate limiter backed by Redis (§38 — brute-force protection).
 * Used on login/register/password-reset so credential-stuffing and
 * enumeration attempts get throttled per IP+identifier, not per request.
 *
 * Sem Redis, conta no Postgres em vez de liberar.
 *
 * Falhar aberto foi escrito para o caso de o Redis cair por alguns minutos.
 * Só que "sem Redis" virou a configuração normal deste deploy, e aí falhar
 * aberto deixou de ser degradação temporária: é força bruta livre na tela de
 * login, permanentemente. O banco já é dependência dura do login — se ele
 * cair não há o que autenticar — então contar lá não acrescenta ponto de
 * falha. A liberação incondicional só sobra quando as duas contagens falham.
 *
 * The client is built on first use, never at import. ioredis parses the URL
 * inside its constructor, so building it at module scope turned a malformed
 * REDIS_URL into a build failure on whichever route Next.js happened to load
 * first — a component designed to fail open taking down everything instead.
 */
let client: IORedis | null = null;
let attempted = false;

function getClient(): IORedis | null {
  if (attempted) return client;
  attempted = true;

  const url = getRedisUrl();
  if (!url) return null;

  try {
    client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    client.on("error", () => {
      // Swallowed: isAllowed below already degrades to "allow", and an
      // unhandled 'error' event would crash the process instead.
    });
  } catch {
    client = null;
  }
  return client;
}

export async function isAllowed(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getClient();

  if (redis) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, windowSeconds);
      }
      return count <= limit;
    } catch {
      // Cai para o Postgres em vez de liberar: um Redis intermitente não
      // pode virar uma janela sem limite nenhum.
    }
  }

  try {
    return await hitRateLimit(`ratelimit:${key}`, limit, windowSeconds);
  } catch {
    // Aqui sim, libera: se nem o banco responde, o login não vai funcionar de
    // qualquer forma, e recusar acrescentaria uma falha em cima de outra.
    return true;
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}
