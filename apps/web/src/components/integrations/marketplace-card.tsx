"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
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

  async function disconnect(accountId: string) {
    await fetch(`/api/integrations/${slug}/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold text-foreground">{name}</CardTitle>
        {!configured && <Badge variant="outline">Configuração pendente</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
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
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_CONFIG[account.status].variant}>{STATUS_CONFIG[account.status].label}</Badge>
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
