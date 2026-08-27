"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";

type KeyEncoding = "raw" | "stripped" | "hex-decoded";

interface SignAttempt {
  encoding: KeyEncoding;
  environment: "test" | "live";
  keyByteLength: number;
  signAccepted: boolean;
  shopeeError: string | null;
}

interface Diagnosis {
  ok: boolean;
  environment: "test" | "live";
  host: string;
  redirectUrl: string;
  partnerIdLength: number;
  partnerKeyLength: number;
  keyEncoding: KeyEncoding;
  keyFingerprint: string;
  keyFormatOk: boolean;
  clockSkewSeconds: number | null;
  acceptedKeyEncoding: KeyEncoding | null;
  acceptedEnvironment: "test" | "live" | null;
  signAttempts: SignAttempt[];
  problems: string[];
  shopeeError: string | null;
  shopCount: number | null;
}

const ENCODING_LABEL: Record<KeyEncoding, string> = {
  raw: "chave como exibida",
  stripped: "sem o prefixo shpk",
  "hex-decoded": "hexadecimal decodificado",
};

/**
 * Checks the Shopee partner credentials against Shopee itself, before anyone
 * is sent through an authorization redirect.
 *
 * `error_sign` shows up at the end of the OAuth flow, where it looks the same
 * whether the key is from the other environment, was pasted short, or the
 * machine's clock drifted. Each guess costs a full round trip through the
 * seller's browser. This asks the question directly.
 *
 * Uma dessas causas não dá para deduzir olhando: a Shopee imprime a
 * partner_key como `shpk` + hexadecimal e não documenta se a string exibida
 * *é* a chave do HMAC. O diagnóstico assina com cada leitura e mostra qual a
 * Shopee aceitou — a tabela abaixo é esse resultado, não uma suposição.
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
            <span>
              Leitura da chave: <strong>{ENCODING_LABEL[result.keyEncoding] ?? result.keyEncoding}</strong>
            </span>
            <span>
              Chave configurada: <strong className="font-mono">{result.keyFingerprint}</strong>
            </span>
            {result.clockSkewSeconds !== null && (
              <span>
                Relógio vs. Shopee: <strong>{Math.round(result.clockSkewSeconds)}s</strong>
              </span>
            )}
          </div>

          {result.signAttempts.length > 1 && (
            <div className="space-y-1 rounded-lg bg-muted/40 px-3 py-2">
              <p className="font-medium">Assinaturas testadas contra a Shopee</p>
              {result.signAttempts.map((a) => (
                <p key={`${a.environment}-${a.encoding}`} className="flex items-center gap-2">
                  <span aria-hidden>{a.signAccepted ? "✓" : "✗"}</span>
                  <span className="font-mono text-[11px]">
                    {a.environment}/{a.encoding}
                  </span>
                  <span className="text-muted-foreground">
                    {ENCODING_LABEL[a.encoding] ?? a.encoding} · {a.keyByteLength} bytes ·{" "}
                    {a.signAccepted ? "assinatura aceita" : (a.shopeeError ?? "recusada")}
                  </span>
                </p>
              ))}
            </div>
          )}

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
              {result.acceptedEnvironment && result.acceptedEnvironment !== result.environment && (
                <p className="rounded bg-background/60 px-2 py-1 font-mono text-[11px]">
                  SHOPEE_ENV={result.acceptedEnvironment}
                </p>
              )}
              {result.acceptedKeyEncoding && result.acceptedKeyEncoding !== result.keyEncoding && (
                <p className="rounded bg-background/60 px-2 py-1 font-mono text-[11px]">
                  SHOPEE_KEY_ENCODING={result.acceptedKeyEncoding}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
