import {
  AlertTriangle,
  BarChart3,
  Calculator,
  MessageCircle,
  PackageSearch,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mx-auto mb-14 max-w-2xl text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-balance text-muted-foreground">{description}</p>}
    </div>
  );
}

export function ProblemSolution() {
  return (
    <section id="solucao" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="O problema"
          title="Você vende bastante. Mas sabe quanto realmente sobra?"
          description="Comissão, taxa, frete subsidiado, ADS, imposto, devolução — cada marketplace mostra os números de um jeito diferente, e nenhum deles mostra o que interessa: o seu lucro líquido real."
        />
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="p-6">
            <TrendingDown className="mb-4 h-8 w-8 text-destructive" />
            <h3 className="mb-2 font-semibold">Faturamento não é lucro</h3>
            <p className="text-sm text-muted-foreground">
              Muitos vendedores só enxergam o total vendido — sem descontar taxas, ADS e custo dos produtos,
              é impossível saber se a operação está saudável.
            </p>
          </Card>
          <Card className="p-6">
            <PackageSearch className="mb-4 h-8 w-8 text-warning" />
            <h3 className="mb-2 font-semibold">Produtos escondendo prejuízo</h3>
            <p className="text-sm text-muted-foreground">
              Um produto pode vender bem e ainda assim dar prejuízo — sem visibilidade por SKU, esse
              problema fica invisível até o fim do mês.
            </p>
          </Card>
          <Card className="p-6">
            <Sparkles className="mb-4 h-8 w-8 text-primary" />
            <h3 className="mb-2 font-semibold">A solução: um painel só</h3>
            <p className="text-sm text-muted-foreground">
              A Mastershopee conecta todas as suas contas e calcula automaticamente o lucro líquido real —
              por pedido, por produto e por marketplace.
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}

const BENEFITS = [
  { icon: TrendingUp, title: "Lucro líquido real", description: "Faturamento menos todos os custos — automaticamente, todos os dias." },
  { icon: PackageSearch, title: "Produtos deficitários", description: "Identifique na hora quais SKUs estão vendendo no prejuízo." },
  { icon: BarChart3, title: "ADS sob controle", description: "ROAS e ACOS por campanha, direto das APIs oficiais dos marketplaces." },
  { icon: Calculator, title: "Precificação inteligente", description: "Simule preços e descubra o mínimo para bater sua margem alvo." },
  { icon: MessageCircle, title: "Resumo diário no WhatsApp", description: "Receba faturamento, lucro e alertas automaticamente todos os dias." },
  { icon: ShieldCheck, title: "Números em que você confia", description: "Todo lucro exibido pode ser explicado linha a linha, sem caixa-preta." },
];

export function Benefits() {
  return (
    <section id="recursos" className="bg-muted/30 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Benefícios" title="Tudo que você precisa para vender com clareza financeira" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="rounded-xl border border-border bg-card p-6">
              <b.icon className="mb-4 h-6 w-6 text-primary" />
              <h3 className="mb-1.5 font-semibold">{b.title}</h3>
              <p className="text-sm text-muted-foreground">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const BREAKDOWN = [
  { label: "Faturamento", value: "R$ 69,90", tone: "text-foreground" },
  { label: "Comissão", value: "-R$ 9,08", tone: "text-destructive" },
  { label: "Taxas", value: "-R$ 2,00", tone: "text-destructive" },
  { label: "ADS", value: "-R$ 8,21", tone: "text-destructive" },
  { label: "Produto + embalagem", value: "-R$ 22,50", tone: "text-destructive" },
  { label: "Imposto", value: "-R$ 4,19", tone: "text-destructive" },
];

export function ProfitExplain() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">Transparência total</p>
          <h2 className="mb-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Nunca mostramos só "lucro: R$ 23,92"
          </h2>
          <p className="mb-6 text-muted-foreground">
            Clique em qualquer número e veja exatamente como ele foi calculado — comissão, taxas, ADS,
            custo do produto e imposto, linha a linha. Em uma plataforma financeira, confiança nos números
            não é opcional.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" /> Custo histórico — nunca recalculamos vendas
              antigas com o custo de hoje
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" /> Dados parciais são sinalizados, nunca
              apresentados como definitivos
            </li>
          </ul>
        </div>
        <Card className="p-6">
          <p className="mb-4 text-sm text-muted-foreground">Como calculamos este pedido</p>
          <div className="space-y-3">
            {BREAKDOWN.map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-border/60 pb-3 text-sm last:border-0">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={`font-medium ${row.tone}`}>{row.value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <span className="font-semibold">Lucro líquido</span>
              <span className="text-lg font-semibold text-success">R$ 23,92</span>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

export function LossProductsShowcase() {
  return (
    <section className="bg-muted/30 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Atenção necessária"
          title="Descubra produtos vendendo no prejuízo antes que doa no caixa"
          description="Identificamos automaticamente SKUs com margem negativa e sugerimos o motivo mais provável."
        />
        <Card className="mx-auto max-w-2xl border-destructive/30 bg-destructive/5 p-6">
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-semibold">Prejuízo identificado</span>
          </div>
          <h3 className="mb-1 font-semibold">Organizador de Tênis Transparente</h3>
          <p className="mb-4 text-sm text-muted-foreground">Você vendeu 38 unidades hoje.</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Faturamento</p>
              <p className="font-semibold">R$ 1.862</p>
            </div>
            <div>
              <p className="text-muted-foreground">Custos totais</p>
              <p className="font-semibold">R$ 1.974</p>
            </div>
            <div>
              <p className="text-muted-foreground">Resultado</p>
              <p className="font-semibold text-destructive">-R$ 112 (-6,0%)</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-card p-3 text-xs text-muted-foreground">
            Motivo provável: ADS acima da média + desconto aplicado. Estimativa: para atingir margem de
            15%, considere preço mínimo de R$ 57,90.
          </div>
        </Card>
      </div>
    </section>
  );
}

export function WhatsAppAndCosts() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-success" />
            <span className="text-sm font-semibold">Resumo diário no WhatsApp</span>
          </div>
          <div className="rounded-xl bg-[#e7f8f0] p-4 text-sm text-[#1a2e22] dark:bg-[#123324] dark:text-[#d4f5e3]">
            <p>Bom dia, Marcos! 👋</p>
            <p className="mt-2">Aqui está o resultado de ontem:</p>
            <p className="mt-2">💰 Faturamento: R$ 12.482,20</p>
            <p>💵 Lucro líquido: R$ 2.781,42</p>
            <p>📈 Margem: 22,28%</p>
            <p>⚠️ 3 produtos venderam com margem negativa</p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Envio via WhatsApp Business Platform (Cloud API oficial) — nunca automações não-oficiais.
          </p>
        </Card>

        <div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">Gestão de custos</p>
          <h2 className="mb-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Custo histórico, nunca recalculado
          </h2>
          <p className="mb-6 text-muted-foreground">
            Cadastre o custo de cada produto e deixe o histórico registrado. Pedidos antigos sempre usam o
            custo que estava vigente na data da venda — o lucro de ontem nunca muda porque você atualizou o
            custo hoje.
          </p>
          <div className="flex items-center gap-3 text-sm">
            {[
              { date: "01/01", value: "R$ 18" },
              { date: "01/03", value: "R$ 20" },
              { date: "01/05", value: "R$ 22" },
            ].map((c, i) => (
              <div key={c.date} className="flex items-center gap-3">
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <p className="text-xs text-muted-foreground">{c.date}</p>
                  <p className="font-medium">{c.value}</p>
                </div>
                {i < 2 && <div className="h-px w-6 bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ComparisonAndAnalytics() {
  return (
    <section className="bg-muted/30 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Analytics"
          title="Compare marketplaces e entenda onde vale mais a pena vender"
        />
        <Card className="overflow-x-auto p-6">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-3 font-medium">Marketplace</th>
                <th className="pb-3 font-medium">Faturamento</th>
                <th className="pb-3 font-medium">Margem líquida</th>
                <th className="pb-3 font-medium">Participação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Shopee", "R$ 34.200", "24,1%", "40%"],
                ["Mercado Livre", "R$ 28.900", "21,8%", "34%"],
                ["TikTok Shop", "R$ 14.100", "26,4%", "17%"],
                ["SHEIN", "R$ 7.030", "19,2%", "9%"],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} className={`py-3 ${i === 0 ? "font-medium" : "text-muted-foreground"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: Receipt, title: "DRE simplificada", description: "Receita bruta até lucro líquido, em um relatório exportável." },
  { icon: Zap, title: "Alertas inteligentes", description: "Seja avisado quando a margem cair ou o ADS passar do limite." },
  { icon: BarChart3, title: "Publicidade", description: "ROAS, ACOS e CPC por campanha, quando a API do marketplace disponibiliza." },
];

export function FeaturesGrid() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Recursos" title="Uma central financeira completa" />
        <div className="grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6 text-center">
              <f.icon className="mx-auto mb-4 h-7 w-7 text-primary" />
              <h3 className="mb-1.5 font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
