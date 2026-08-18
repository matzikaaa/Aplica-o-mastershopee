"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

interface SyncStatusResponse {
  accountStatus: string;
  sync: { status: string; itemsProcessed: number; errorMessage: string | null } | null;
}

/**
 * Live first-sync progress (§82). Polls real IntegrationSync state instead
 * of showing invented "Buscando produtos... Calculando resultados..."
 * steps we have no signal for — honesty over cosmetics (§3, §99).
 */
export function SyncProgress({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [state, setState] = useState<SyncStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/integrations/sync-status?accountId=${accountId}`);
        if (!res.ok || cancelled) return;
        const data: SyncStatusResponse = await res.json();
        if (cancelled) return;
        setState(data);

        const stillRunning = data.sync && (data.sync.status === "QUEUED" || data.sync.status === "RUNNING");
        if (stillRunning) {
          timer = setTimeout(poll, 2000);
        } else {
          router.refresh();
        }
      } catch {
        // Network hiccup during polling — try again shortly rather than freezing the UI.
        if (!cancelled) timer = setTimeout(poll, 3000);
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, router]);

  if (!state?.sync || (state.sync.status !== "QUEUED" && state.sync.status !== "RUNNING")) return null;

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      Sincronizando... {state.sync.itemsProcessed} itens processados
    </div>
  );
}
