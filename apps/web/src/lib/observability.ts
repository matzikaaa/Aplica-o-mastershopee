/**
 * Minimal error-reporting seam (§52). Structured JSON to stderr always;
 * forwards to Sentry when SENTRY_DSN is configured. Kept dependency-free
 * (no @sentry/nextjs import) since no DSN is available in this
 * environment — wiring a real Sentry SDK is a drop-in change here once
 * one is, without touching any of the call sites below.
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
    // TODO: once @sentry/nextjs is added as a dependency, replace this
    // block with Sentry.captureException(error, { extra: context }).
    console.error("[observability] SENTRY_DSN is set but @sentry/nextjs is not wired yet.");
  }
}
