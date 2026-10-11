"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
        {/* Para o cliente, o que importa é se dá para usar — não que faltam
            credenciais de parceiro, que é assunto do dono da plataforma. */}
        {!configured && <Badge variant="outline">Em breve</Badge>}
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
            {configured ? (
              "Nenhuma conta conectada."
            ) : (
              <>
                A integração automática está em desenvolvimento. Enquanto isso, os pedidos entram por planilha em{" "}
                <a href="/import" className="font-medium text-primary hover:underline">
                  Importar
                </a>
                .
              </>
            )}
          </p>
        )}
        {accounts.map((account) => (
          <div key={account.id} className="space-y-3 rounded-lg border border-border p-3">
            {/* Nome e status em cima, ações embaixo: no card de meia largura,
                três botões ao lado do nome espremiam o texto em quatro linhas. */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{account.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {account.lastSyncAt ? `Última sincronização ${relativeTime(account.lastSyncAt)}` : "Nunca sincronizado"}
                </p>
                {account.status === "SYNCING" && <SyncProgress accountId={account.id} />}
              </div>
              <Badge variant={STATUS_CONFIG[account.status].variant} className="shrink-0">
                {STATUS_CONFIG[account.status].label}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
                <a href={`/api/integrations/${slug}/connect`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Reconectar
                </a>
              )}
              <Button size="sm" variant="outline" onClick={() => setConfirmDisconnect(account.id)}>
                Desconectar
              </Button>
            </div>
          </div>
        ))}

        {/* Botão dentro de link é HTML inválido, e o link continuava
            navegável pelo teclado com o botão "desativado". Sem integração,
            não há o que conectar: o texto acima já aponta a planilha. */}
        {configured && accounts.filter((a) => a.status !== "DISCONNECTED").length < limit && (
          <a href={`/api/integrations/${slug}/connect`} className={buttonVariants({ size: "sm" })}>
            Conectar
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
