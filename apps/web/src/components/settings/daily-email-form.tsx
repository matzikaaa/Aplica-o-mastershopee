"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

/**
 * Resumo diário por e-mail.
 *
 * Alternativa ao WhatsApp, não substituto: montar uma conta na Meta exige
 * número dedicado, verificação de empresa e cartão cadastrado. Exigir isso de
 * um vendedor só para ele receber o próprio relatório afastaria a maioria —
 * e o e-mail entrega os mesmos números hoje, sem nada disso.
 */
export function DailyEmailForm({
  enabled,
  to,
  ownerEmail,
}: {
  enabled: boolean;
  to: string | null;
  ownerEmail: string;
}) {
  const router = useRouter();
  const [ativo, setAtivo] = useState(enabled);
  const [endereco, setEndereco] = useState(to ?? "");
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvar() {
    setSalvando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/settings/daily-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: ativo, to: endereco }),
      });
      const data = await res.json();
      setAviso(res.ok ? { ok: true, texto: "Preferência salva." } : { ok: false, texto: data.error });
      if (res.ok) router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function enviarAgora() {
    setEnviando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/settings/email/send-report", { method: "POST" });
      const data = await res.json();
      setAviso(
        res.ok
          ? { ok: true, texto: `Resumo enviado para ${data.to}. Confira a caixa de entrada.` }
          : { ok: false, texto: data.error ?? "Falha no envio." },
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Todo dia às 6h30 você recebe o resultado do dia anterior e os produtos que precisam de reposição — os
        mesmos números do WhatsApp, sem depender de conta na Meta.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Receber o resumo diário por e-mail
      </label>

      <label className="block text-sm">
        Enviar para
        <input
          value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
          placeholder={ownerEmail}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Em branco, vai para {ownerEmail}.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={salvar} disabled={salvando || enviando}>
          <Mail className="mr-2 h-4 w-4" />
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={enviarAgora} disabled={salvando || enviando}>
          <Send className="mr-2 h-4 w-4" />
          {enviando ? "Enviando..." : "Enviar resumo de ontem agora"}
        </Button>
      </div>

      {aviso && (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            aviso.ok ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
