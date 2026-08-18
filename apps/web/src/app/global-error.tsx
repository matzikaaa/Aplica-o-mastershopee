"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/observability";

/**
 * Catches errors thrown by the root layout itself (rare, but the one case
 * `error.tsx` can't handle since it needs its own <html>/<body> — §44).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError(error, { digest: error.digest, boundary: "global" });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "1.5rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Algo deu muito errado</h1>
          <p style={{ maxWidth: "24rem", color: "#666" }}>
            Recarregue a página. Se o problema persistir, contate o suporte.
          </p>
          <button
            onClick={reset}
            style={{ padding: "0.5rem 1rem", borderRadius: "0.5rem", background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
