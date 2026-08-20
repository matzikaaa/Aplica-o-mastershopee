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

      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          {
            step: "1",
            title: "Descobrir SKUs",
            body: "Suba um relatório qualquer. Lemos só a coluna de SKU e montamos o catálogo — você não precisa digitar nada.",
          },
          {
            step: "2",
            title: "Preencher custos",
            body: "Com os SKUs já cadastrados, informe o custo de cada um em Custos, na mão ou por planilha.",
          },
          {
            step: "3",
            title: "Importar pedidos",
            body: "Aí sim o histórico entra e cada venda já encontra o custo vigente na data — lucro real, não estimado.",
          },
        ].map((s) => (
          <li key={s.step} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-sm font-medium">
              <span className="mr-2 text-muted-foreground tabular-nums">{s.step}.</span>
              {s.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>

      <ImportTabs />

      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Importar a mesma planilha duas vezes não duplica nada: SKUs são reconhecidos pelo código, pedidos pelo número
        do pedido e gastos de anúncio por campanha e dia — a segunda importação corrige a primeira. Valores em branco
        ou ilegíveis viram erro na linha, nunca zero silencioso.
      </div>
    </div>
  );
}
