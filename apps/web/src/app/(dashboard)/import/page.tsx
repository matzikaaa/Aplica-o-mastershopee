import { requireWorkspace } from "@/lib/session";
import { ImportTabs } from "@/components/import/import-tabs";

export const dynamic = "force-dynamic";

/**
 * Bulk load from marketplace exports. This is what makes the app usable with
 * a real catalogue before any API integration is approved: the seller centre
 * already exports orders and ad reports as spreadsheets.
 */
export default async function ImportPage() {
  await requireWorkspace();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar planilha</h1>
        <p className="text-sm text-muted-foreground">
          Carregue produtos, histórico de pedidos e gastos com anúncios direto das exportações do marketplace.
        </p>
      </div>

      <ImportTabs />

      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Importar a mesma planilha duas vezes não duplica nada: pedidos são reconhecidos pelo número do pedido e
        gastos de anúncio por campanha e dia — a segunda importação corrige a primeira. Valores em branco ou
        ilegíveis viram erro na linha, nunca zero silencioso.
      </div>
    </div>
  );
}
