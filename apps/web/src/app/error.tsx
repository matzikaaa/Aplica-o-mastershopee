"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureError } from "@/lib/observability";

/**
 * Route-segment error boundary (§44 — never leave a blank screen). Next.js
 * renders this instead of crashing to a blank page whenever a Server or
 * Client Component throws during render.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-destructive/10 p-3">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <h1 className="text-lg font-semibold">Algo deu errado</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Não foi possível carregar esta página. Nossa equipe já foi notificada automaticamente.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Tentar novamente</Button>
        <Link href="/dashboard" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
          Voltar ao painel
        </Link>
      </div>
    </div>
  );
}
