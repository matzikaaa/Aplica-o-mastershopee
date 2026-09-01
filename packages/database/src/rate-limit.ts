import { prisma } from "./index";

/**
 * Janela fixa contada no Postgres, para quando não há Redis.
 *
 * Um único `INSERT ... ON CONFLICT` porque a contagem precisa ser atômica:
 * ler-e-depois-gravar deixa duas tentativas simultâneas passarem pelo mesmo
 * limite, que é exatamente o que um ataque de força bruta faz.
 *
 * A janela reinicia sozinha na expiração, na mesma instrução — sem job de
 * limpeza no caminho crítico do login. Linhas velhas de chaves que nunca mais
 * aparecem ficam para `purgeExpiredRateLimits`.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + windowSeconds * 1000);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitCounter" ("key", "count", "expiresAt")
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitCounter"."expiresAt" < now() THEN 1
        ELSE "RateLimitCounter"."count" + 1
      END,
      "expiresAt" = CASE
        WHEN "RateLimitCounter"."expiresAt" < now() THEN ${expiresAt}
        ELSE "RateLimitCounter"."expiresAt"
      END
    RETURNING "count"
  `;

  const count = rows[0]?.count ?? 1;
  return count <= limit;
}

export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
