"use client";

import { useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Direitos do titular sobre os próprios dados (LGPD art. 18).
 *
 * Exportar e excluir precisam existir na interface, não só como rota: um
 * direito que exige abrir o terminal para ser exercido não está disponível
 * para a pessoa que a lei protege.
 *
 * A exclusão pede o nome do workspace digitado, e não um "tem certeza?".
 * É irreversível, e um clique de confirmação genérico não distingue
 * intenção de acidente.
 */
export function AccountDataSection({ workspaceName, isOwner }: { workspaceName: string; isOwner: boolean }) {
  const [confirmacao, setConfirmacao] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function excluir() {
    setExcluindo(true);
    setErro(null);
    try {
      const res = await fetch("/api/settings/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível excluir a conta.");
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha de rede.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <section className="space-y-6 rounded-xl border border-border bg-card px-5 py-5">
      <div>
        <h2 className="text-sm font-medium">Seus dados</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Você pode levar seus dados embora ou apagar tudo, a qualquer momento.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Baixe um arquivo com tudo que guardamos: perfil, produtos, custos, pedidos, métricas e registros de
          auditoria. As credenciais das integrações não vão junto — exportar um token não ajuda você e cria uma
          cópia do segredo fora do sistema.
        </p>
        <a
          href="/api/settings/account/export"
          download
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Exportar meus dados
        </a>
      </div>

      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <TriangleAlert className="h-4 w-4" />
          Excluir a conta
        </p>
        {isOwner ? (
          <>
            <p className="text-xs">
              Apaga o workspace <strong>{workspaceName}</strong> e tudo dentro dele: pedidos, produtos, custos,
              histórico e integrações. <strong>Não há como desfazer</strong> — e não guardamos cópia. Exporte seus
              dados antes, se quiser ficar com eles.
            </p>
            <label className="block text-xs">
              Para confirmar, digite <strong>{workspaceName}</strong>:
              <input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                placeholder={workspaceName}
              />
            </label>
            {erro && <p className="text-xs text-destructive">{erro}</p>}
            <Button
              size="sm"
              variant="destructive"
              onClick={excluir}
              disabled={excluindo || confirmacao !== workspaceName}
            >
              {excluindo ? "Excluindo..." : "Excluir permanentemente"}
            </Button>
          </>
        ) : (
          <p className="text-xs">
            Só o proprietário do workspace pode excluí-lo. Para apagar seus dados, peça a ele — ou fale com o
            suporte.
          </p>
        )}
      </div>
    </section>
  );
}
