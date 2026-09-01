/**
 * Inicialização do Sentry (§52).
 *
 * Roda uma vez por processo, antes de qualquer rota. Sem SENTRY_DSN o
 * `init` não é chamado e a aplicação segue idêntica — monitoramento é o
 * tipo de coisa que não pode virar dependência dura, senão uma falha do
 * monitoramento derruba o que ele deveria observar.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Amostragem baixa por padrão: rastreamento completo em produção custa
    // caro e não é o que responde "quem quebrou hoje".
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    // Dados do vendedor não vão junto do erro sem necessidade.
    sendDefaultPii: false,
  });
}
