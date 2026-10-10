"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SyncProgress } from "./sync-progress";
import { relativeTime } from "@/lib/utils";

type Status = "NOT_CONNECTED" | "CONNECTING" | "SYNCING" | "CONNECTED" | "ERROR" | "TOKEN_EXPIRED" | "DISCONNECTED";

const STATUS_CONFIG: Record<Status, { label: string; variant: "default" | "success" | "warning" | "destructive" }> = {
  NOT_CONNECTED: { label: "Não conectado", variant: "default" },
  CONNECTING: { label: "Conectando", variant: "warning" },
  SYNCING: { label: "Sincronizando", variant: "warning" },
  CONNECTED: { label: "Conectado", variant: "success" },
  ERROR: { label: "Erro", variant: "destructive" },
  TOKEN_EXPIRED: { label: "Token expirado", variant: "destructive" },
  DISCONNECTED: { label: "Desconectado", variant: "default" },
};

export interface MarketplaceAccountView {
  id: string;
  displayName: string;
  status: Status;
  lastSyncAt: string | null;
}

export function MarketplaceCard({
  name,
  slug,
  configured,
  accounts,
  limit,
}: {
  name: string;
  slug: string;
  configured: boolean;
  accounts: MarketplaceAccountView[];
  limit: number;
}) {
  const router = useRouter();
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState<string | null>(null);
  const [retorno, setRetorno] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  /**
   * As duas ações leem a resposta. Antes, nenhuma lia: um 500 recarregava a
   * tela como se tudo tivesse dado certo, e "Sincronizar agora" não fazia
   * nada em produção sem que ninguém conseguisse perceber.
   */
  async function chamar(caminho: string, accountId: string) {
    const res = await fetch(`/api/integrations/${slug}/${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    const dados = (await res.json().catch(() => ({}))) as { error?: string; gravados?: number };
    if (!res.ok) throw new Error(dados.error ?? `Falha (${res.status}).`);
    return dados;
  }

  async function disconnect(accountId: string) {
    setRetorno(null);
    try {
      await chamar("disconnect", accountId);
      router.refresh();
    } catch (err) {
      setRetorno({ tipo: "erro", texto: err instanceof Error ? err.message : "Falha ao desconectar." });
    }
  }

  async function syncNow(accountId: string) {
    setSincronizando(accountId);
    setRetorno(null);
    try {
      const dados = await chamar("sync", accountId);
      setRetorno({
        tipo: "ok",
        texto:
          dados.gravados && dados.gravados > 0
            ? `${dados.gravados} pedido(s) atualizado(s).`
            : "Tudo em dia — nenhum pedido novo desde a última sincronização.",
      });
      router.refresh();
    } catch (err) {
      setRetorno({ tipo: "erro", texto: err instanceof Error ? err.message : "Falha ao sincronizar." });
    } finally {
      setSincronizando(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold text-foreground">{name}</CardTitle>
        {!configured && <Badge variant="outline">Configuração pendente</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {retorno && (
          <p
            role={retorno.tipo === "erro" ? "alert" : "status"}
            className={
              retorno.tipo === "erro"
                ? "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                : "rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success"
            }
          >
            {retorno.texto}
          </p>
        )}
        {accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {configured ? "Nenhuma conta conectada." : "Aguardando credenciais de parceiro (ver README de integrações)."}
          </p>
        )}
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">{account.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {account.lastSyncAt ? `Última sincronização ${relativeTime(account.lastSyncAt)}` : "Nunca sincronizado"}
              </p>
              {account.status === "SYNCING" && <SyncProgress accountId={account.id} />}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_CONFIG[account.status].variant}>{STATUS_CONFIG[account.status].label}</Badge>
              {(account.status === "CONNECTED" || account.status === "ERROR") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncNow(account.id)}
                  disabled={sincronizando !== null}
                >
                  {sincronizando === account.id ? "Sincronizando..." : "Sincronizar agora"}
                </Button>
              )}
              {account.status === "TOKEN_EXPIRED" && (
                <a href={`/api/integrations/${slug}/connect`}>
                  <Button size="sm" variant="outline">
                    Reconectar
                  </Button>
                </a>
              )}
              <Button size="sm" variant="outline" onClick={() => setConfirmDisconnect(account.id)}>
                Desconectar
              </Button>
            </div>
          </div>
        ))}

        {accounts.filter((a) => a.status !== "DISCONNECTED").length < limit && (
          <a href={`/api/integrations/${slug}/connect`} className="inline-block">
            <Button size="sm" disabled={!configured}>
              Conectar
            </Button>
          </a>
        )}

        <ConfirmDialog
          open={Boolean(confirmDisconnect)}
          onClose={() => setConfirmDisconnect(null)}
          onConfirm={() => confirmDisconnect && disconnect(confirmDisconnect)}
          title="Desconectar conta"
          description="A sincronização será interrompida. Pedidos já importados continuam disponíveis."
          confirmLabel="Desconectar"
          destructive
        />
      </CardContent>
    </Card>
  );
}
