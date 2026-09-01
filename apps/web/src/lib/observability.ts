/**
 * Ponto único de reporte de erro (§52).
 *
 * JSON estruturado no stderr sempre — é o que a Vercel guarda e o que
 * funciona sem nenhuma configuração. Encaminha ao Sentry quando SENTRY_DSN
 * existe, porque log de plataforma responde "o que aconteceu naquele
 * minuto" e não responde "quantos clientes bateram nisso esta semana".
 */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "error",
      message,
      stack,
      context,
      ts: new Date().toISOString(),
    }),
  );

  if (process.env.SENTRY_DSN) {
    // Import dinâmico e falha engolida de propósito: uma indisponibilidade do
    // monitoramento não pode derrubar o caminho que ele observa. O log
    // estruturado acima já saiu, então nada se perde por completo.
    void import("@sentry/nextjs")
      .then((Sentry) => Sentry.captureException(error, { extra: context }))
      .catch(() => undefined);
  }
}
