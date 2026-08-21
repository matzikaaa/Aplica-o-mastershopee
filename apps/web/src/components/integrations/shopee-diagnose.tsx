"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Diagnosis {
  ok: boolean;
  environment: "test" | "live";
  host: string;
  redirectUrl: string;
  partnerIdLength: number;
  partnerKeyLength: number;
  problems: string[];
  shopeeError: string | null;
  shopCount: number | null;
}

/**
 * Checks the Shopee partner credentials against Shopee itself, before anyone
 * is sent through an authorization redirect.
 *
 * `error_sign` shows up at the end of the OAuth flow, where it looks the same
 * whether the key is from the other environment, was pasted short, or the
 * machine's clock drifted. Each guess costs a full round trip through the
 * seller's browser. This asks the question directly.
 */
export function ShopeeDiagnose() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Diagnosis | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/integrations/shopee/diagnose", { method: "POST" });
    setResult((await res.json()) as Diagnosis);
    setLoading(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Diagnóstico da Shopee</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pergunta à Shopee se as credenciais e a assinatura são aceitas, sem passar pela autorização da loja.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading} className="shrink-0 gap-2">
          <Stethoscope className="h-4 w-4" />
          {loading ? "Verificando..." : "Verificar credenciais"}
        </Button>
      </div>

      {result && (
        <div className="space-y-2 text-xs">
          <div className="grid gap-1 rounded-lg bg-muted/40 px-3 py-2 sm:grid-cols-2">
            <span>
              Ambiente: <strong>{result.environment}</strong>
            </span>
            <span className="truncate" title={result.host}>
              Host: {result.host.replace("https://", "")}
            </span>
            <span>
              partner_id: {result.partnerIdLength} dígitos · partner_key: {result.partnerKeyLength} caracteres
            </span>
            <span className="truncate" title={result.redirectUrl}>
              Redirect: {result.redirectUrl || "não configurado"}
            </span>
          </div>

          {result.ok ? (
            <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2">
              ✓ Credenciais aceitas pela Shopee. {result.shopCount === 0
                ? "Nenhuma loja autorizou o app ainda — é o próximo passo, em Conectar."
                : `${result.shopCount} loja(s) já autorizaram.`}
            </p>
          ) : (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              {result.problems.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {result.shopeeError && (
                <p className="font-mono text-[11px] opacity-80">Resposta da Shopee: {result.shopeeError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
