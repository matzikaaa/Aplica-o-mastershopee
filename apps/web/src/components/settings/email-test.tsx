"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Conferir que o e-mail sai de verdade.
 *
 * SMTP configurado e SMTP entregando são coisas diferentes. Sem este botão,
 * a primeira pessoa a descobrir que a entrega falhou seria alguém que se
 * cadastrou e nunca recebeu o link — e que não tem como avisar, porque o
 * canal de aviso é justamente o que quebrou.
 */
export function EmailTest({ email }: { email: string }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null);

  async function enviar() {
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/settings/email/test", { method: "POST" });
      const data = await res.json();
      setResultado(
        res.ok
          ? { ok: true, mensagem: `Enviado para ${data.to}. Confira a caixa de entrada e o spam.` }
          : { ok: false, mensagem: data.error ?? "Falha no envio." },
      );
    } catch (err) {
      setResultado({ ok: false, mensagem: err instanceof Error ? err.message : "Falha de rede." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Confirmação de cadastro e recuperação de senha dependem do envio de e-mail. Mande um teste para{" "}
        <strong>{email}</strong> e confirme que chega — configuração aceita não é o mesmo que entrega feita.
      </p>

      <Button type="button" variant="outline" size="sm" onClick={enviar} disabled={enviando} className="gap-2">
        <Mail className="h-4 w-4" />
        {enviando ? "Enviando..." : "Enviar e-mail de teste"}
      </Button>

      {resultado && (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            resultado.ok
              ? "border-success/30 bg-success/10"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {resultado.mensagem}
        </p>
      )}
    </div>
  );
}
