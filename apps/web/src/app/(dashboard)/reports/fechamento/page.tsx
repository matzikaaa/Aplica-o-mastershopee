import Link from "next/link";
import type { ReactNode } from "react";
import { Download, Lock } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import {
  mesAnterior,
  mesValido,
  montarFechamentoMensal,
  rotuloDoMes,
  type LinhaDePedido,
} from "@/lib/fechamento-mensal";
import { PrintButton } from "@/components/reports/print-button";
import { BuscarNotasButton } from "@/components/reports/buscar-notas-button";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { somarDias } from "@mastershopee/shared";

export const dynamic = "force-dynamic";

// `|| 0` troca −0 por 0: uma linha zerada não leva sinal de menos.
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const num = (v: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const pct = (v: number) => `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)}%`;

/** Os 24 meses até o atual, do mais recente para trás, para o seletor. */
function mesesParaEscolher(atual: string): string[] {
  const meses: string[] = [];
  let cursor = `${atual}-01`;
  for (let i = 0; i < 24; i++) {
    meses.push(cursor.slice(0, 7));
    cursor = `${somarDias(cursor, -1).slice(0, 7)}-01`;
  }
  return meses;
}

/**
 * Fechamento mensal para o contador — o documento.
 *
 * Feito para sair em papel ou PDF: A4, sem o menu do app, números alinhados
 * e totais que batem com a lista de pedidos logo abaixo. A planilha com as
 * mesmas abas sai do mesmo montador (`montarFechamentoMensal`).
 */
export default async function FechamentoPage({ searchParams }: { searchParams: { mes?: string } }) {
  const { workspace } = await requireWorkspace();
  const tz = workspace.timezone;
  const mes = mesValido(searchParams.mes) ? searchParams.mes : mesAnterior(tz);
  const [f, permissions] = await Promise.all([
    montarFechamentoMensal(workspace.id, mes),
    getPlanPermissionService(workspace.id),
  ]);
  const planilhaLiberada = permissions.canUseAdvancedReports().allowed;
  const mesAtual = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date()).slice(0, 7);
  const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: tz });
  const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz });

  const totais = somar(f.pedidos);
  const totaisProdutos = {
    vendas: f.produtos.reduce((a, p) => a + p.vendas, 0),
    cmv: f.produtos.reduce((a, p) => a + p.cmv, 0),
    lucro: f.produtos.reduce((a, p) => a + p.lucro, 0),
  };
  const faltaIdentificacao = !f.empresa.razaoSocial || !f.empresa.documento;
  // A coluna NF só aparece quando há nota: para quem não emite, seria uma coluna de traços.
  const temNotas = f.pedidos.some((p) => p.nf) || f.naoReceita.some((p) => p.nf);

  return (
    <div className="space-y-4">
      {/* @page só vale na impressão: A4 com margem de documento. */}
      <style>{`@page { size: A4; margin: 12mm 11mm; } @media print { html, body { background: #fff; } }`}</style>

      <div className="mx-auto flex max-w-[210mm] flex-col gap-3 print:hidden sm:flex-row sm:items-end sm:justify-between">
        <form method="get" className="flex items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="mes" className="text-xs font-medium text-muted-foreground">
              Mês do fechamento
            </label>
            <Select id="mes" name="mes" defaultValue={mes} className="w-56">
              {mesesParaEscolher(mesAtual).map((m) => (
                <option key={m} value={m}>
                  {rotuloDoMes(m)}
                  {m === mesAtual ? " (em andamento)" : ""}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonVariants({ variant: "outline" })}>
            Ver
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          {planilhaLiberada ? (
            <a
              href={`/api/reports/fechamento?mes=${mes}`}
              className={buttonVariants({ variant: "outline", className: "gap-2" })}
            >
              <Download className="h-4 w-4" /> Planilha (XLSX)
            </a>
          ) : (
            <span className="flex items-center gap-1.5 px-2 text-sm text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Planilha no plano Pro
            </span>
          )}
        </div>
      </div>

      {faltaIdentificacao && (
        <p className="mx-auto max-w-[210mm] rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm print:hidden">
          Falta {!f.empresa.razaoSocial && !f.empresa.documento ? "razão social e CNPJ" : !f.empresa.razaoSocial ? "a razão social" : "o CNPJ"} no
          cabeçalho — é a primeira coisa que o contador confere.{" "}
          <Link href="/settings" className="font-medium text-primary hover:underline">
            Preencher em Configurações › Empresa
          </Link>
        </p>
      )}

      {f.notas.contaShopeeConectada && f.notas.semNota > 0 && (
        <div className="mx-auto max-w-[210mm] space-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm print:hidden">
          <p>
            <span className="font-medium">Notas fiscais:</span> {f.notas.comNota} de {f.notas.pedidosShopee} pedidos da
            Shopee deste mês têm a nota no app. Pedidos sincronizados antes de o app trazer a nota precisam de uma
            busca — ela lê só a nota de cada pedido na Shopee e leva alguns segundos.
          </p>
          <BuscarNotasButton mes={mes} />
        </div>
      )}

      <article className="mx-auto max-w-[210mm] rounded-xl border border-border bg-card px-5 py-6 text-[13px] sm:px-10 sm:py-9 leading-relaxed text-foreground shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:text-[9.5pt] print:shadow-none">
        <header className="flex flex-col gap-3 border-b-2 border-foreground pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 print:flex-row print:items-start print:justify-between print:gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Fechamento mensal
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight print:text-[18pt]">{f.rotuloMes}</h1>
            <p className="mt-1 text-muted-foreground">
              Período de {data.format(f.periodo.from)} a {data.format(f.periodo.to)}
              {f.emAndamento && " · mês em andamento"}
            </p>
          </div>
          <dl className="sm:shrink-0 sm:text-right print:shrink-0 print:text-right">
            <dt className="sr-only">Empresa</dt>
            <dd className="font-semibold">{f.empresa.razaoSocial ?? f.empresa.nome}</dd>
            {f.empresa.documento && (
              <dd className="tabular-nums text-muted-foreground">
                {f.empresa.documento.length > 14 ? "CNPJ" : "CPF"} {f.empresa.documento}
              </dd>
            )}
            {f.empresa.regime && <dd className="text-muted-foreground">{f.empresa.regime}</dd>}
            <dd className="mt-1 text-[11px] text-muted-foreground">Gerado em {dataHora.format(f.geradoEm)}</dd>
          </dl>
        </header>

        <Secao titulo="Resultado do mês" subtitulo="Demonstrativo gerencial — dos pedidos válidos do período">
          <table className="w-full tabular-nums">
            <tbody>
              <Linha rotulo="Vendas brutas (preço dos produtos)" valor={f.dre.vendasBrutas} forte />
              <Linha rotulo="(−) Descontos concedidos" valor={-f.dre.descontos} />
              <Linha rotulo="(−) Devoluções e reembolsos" valor={-f.dre.reembolsos} />
              <Linha rotulo="= Receita líquida de vendas" valor={f.dre.receitaLiquida} forte divisor />
              <Linha rotulo="(−) CMV — custo dos produtos vendidos" valor={-f.dre.cmv} />
              <Linha rotulo="(−) Embalagem e custo operacional" valor={-f.dre.embalagemOperacional} />
              <Linha rotulo="= Lucro bruto" valor={f.dre.lucroBruto} forte divisor />
              <Linha rotulo="(−) Comissões do marketplace" valor={-f.dre.comissoes} />
              <Linha rotulo="(−) Outras tarifas do marketplace" valor={-f.dre.tarifas} />
              <Linha rotulo="(−) Frete pago pelo vendedor" valor={-f.dre.frete} />
              <Linha rotulo="(−) Anúncios (ADS)" valor={-f.dre.ads} />
              <Linha rotulo="(−) Impostos (pela alíquota cadastrada em Custos)" valor={-f.dre.impostos} />
              <Linha rotulo="(−) Outros custos" valor={-f.dre.outros} />
              <Linha rotulo="= Lucro líquido" valor={f.dre.lucroLiquido} forte divisor destaque />
              <tr>
                <td className="pt-1 text-muted-foreground">Margem líquida sobre as vendas</td>
                <td className="pt-1 text-right text-muted-foreground">{pct(f.dre.margem)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Relatório gerencial, a partir dos pedidos sincronizados e importados, no fuso {tz.replace("_", " ")}. Não
            substitui a escrituração contábil nem as notas fiscais emitidas; custos, embalagem e alíquota de imposto são
            os cadastrados pela empresa em Custos.
          </p>
        </Secao>

        <Secao titulo="Números do mês">
          <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
            <Numero rotulo="Pedidos válidos" valor={f.numeros.pedidos.toLocaleString("pt-BR")} />
            <Numero rotulo="Unidades vendidas" valor={f.numeros.unidades.toLocaleString("pt-BR")} />
            <Numero rotulo="Ticket médio" valor={brl(f.numeros.ticketMedio)} />
            <Numero
              rotulo="Cancelados (fora da receita)"
              valor={`${f.numeros.cancelados.quantidade} · ${brl(f.numeros.cancelados.valor)}`}
            />
            <Numero
              rotulo="Devolvidos ou reembolsados"
              valor={`${f.numeros.devolvidos.quantidade} · ${brl(f.numeros.devolvidos.valor)}`}
            />
            {f.notas.pedidosShopee > 0 && (
              <Numero
                rotulo="NF-e vinculadas (Shopee)"
                valor={`${f.notas.comNota} de ${f.notas.pedidosShopee}`}
                nota={f.notas.semNota > 0 ? `${f.notas.semNota} pedido(s) sem nota` : "todos os pedidos com nota"}
              />
            )}
            <Numero
              rotulo="Repasse confirmado pela Shopee"
              valor={brl(f.repasses.confirmado)}
              nota={`${f.repasses.pedidosConfirmados} pedido(s)${f.repasses.pedidosPendentes ? ` · ${f.repasses.pedidosPendentes} a liberar` : ""}`}
            />
          </dl>
          <p className="mt-3 text-[11px] text-muted-foreground">
            O repasse confirmado é o valor que a Shopee informou ter liberado em cada pedido — o número para conciliar
            com o extrato da conta. Pedidos “a liberar” ainda não tiveram o repasse fechado.
          </p>
        </Secao>

        {f.porLoja.length > 1 && (
          <Secao titulo="Por loja">
            <Tabela
              cabecalho={["Loja", "Marketplace", "Pedidos", "Vendas (R$)", "Lucro (R$)"]}
              alinharDireitaDesde={2}
              linhas={f.porLoja.map((l) => [l.loja, l.marketplace, String(l.pedidos), num(l.vendas), num(l.lucro)])}
              rodape={[
                "Total",
                "",
                String(f.porLoja.reduce((a, l) => a + l.pedidos, 0)),
                num(f.porLoja.reduce((a, l) => a + l.vendas, 0)),
                num(f.porLoja.reduce((a, l) => a + l.lucro, 0)),
              ]}
            />
          </Secao>
        )}

        <Secao
          titulo="Receita dos últimos 12 meses"
          subtitulo="Para conferir a receita acumulada (RBT12) — a base oficial é a das notas fiscais emitidas"
        >
          <Tabela
            cabecalho={["Mês", "Pedidos", "Vendas brutas", "Descontos", "Reembolsos", "Receita líquida", "Lucro líquido"]}
            alinharDireitaDesde={1}
            linhas={f.ultimos12Meses.map((m) => [
              m.rotulo,
              m.pedidos.toLocaleString("pt-BR"),
              num(m.vendasBrutas),
              num(m.descontos),
              num(m.reembolsos),
              num(m.receitaLiquida),
              m.lucro === null ? "—" : num(m.lucro),
            ])}
            rodape={[
              "Acumulado em 12 meses",
              f.ultimos12Meses.reduce((a, m) => a + m.pedidos, 0).toLocaleString("pt-BR"),
              num(f.ultimos12Meses.reduce((a, m) => a + m.vendasBrutas, 0)),
              num(f.ultimos12Meses.reduce((a, m) => a + m.descontos, 0)),
              num(f.ultimos12Meses.reduce((a, m) => a + m.reembolsos, 0)),
              num(f.receita12Meses),
              "",
            ]}
          />
        </Secao>

        {f.atencao.length > 0 && (
          <Secao titulo="Pontos de atenção">
            <ul className="list-disc space-y-1 pl-5">
              {f.atencao.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Secao>
        )}

        <Secao
          titulo={`Pedidos do mês (${f.pedidos.length.toLocaleString("pt-BR")})`}
          subtitulo={`Valores em R$. Taxas = comissão + outras tarifas. Custos = produto + embalagem + outros.${
            temNotas ? " NF = número da nota fiscal vinculada ao pedido na Shopee." : ""
          }`}
          quebraAntes
        >
          {f.pedidos.length === 0 ? (
            <p className="text-muted-foreground">Nenhum pedido válido no período.</p>
          ) : (
            <Tabela
              compacta
              cabecalho={[
                "Pedido",
                "Data",
                ...(temNotas ? ["NF"] : []),
                "Vendas",
                "Desc.",
                "Taxas",
                "Frete",
                "ADS",
                "Custos",
                "Impostos",
                "Lucro",
                "Repasse",
              ]}
              alinharDireitaDesde={2}
              linhas={f.pedidos.map((p) => [
                <span key="n" className="whitespace-nowrap font-mono text-[0.92em]">
                  {p.numero}
                  {(p.taxasEstimadas || p.semCusto) && (
                    <span className="text-warning" title={p.taxasEstimadas ? "Tarifas ainda não liberadas" : "Item sem custo cadastrado"}>
                      {" "}*
                    </span>
                  )}
                </span>,
                data.format(p.data),
                ...(temNotas ? [p.nf?.numero ?? "—"] : []),
                num(p.vendas),
                num(p.descontos),
                num(p.comissao + p.tarifas),
                num(p.frete),
                num(p.ads),
                num(p.cmv + p.embalagemOperacional + p.outros),
                num(p.impostos),
                num(p.lucro),
                p.repasse === null ? "—" : num(p.repasse),
              ])}
              rodape={[
                "Total",
                "",
                ...(temNotas ? [""] : []),
                num(totais.vendas),
                num(totais.descontos),
                num(totais.taxas),
                num(totais.frete),
                num(totais.ads),
                num(totais.custos),
                num(totais.impostos),
                num(totais.lucro),
                f.repasses.pedidosConfirmados > 0 ? num(totais.repasse) : "—",
              ]}
            />
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            * Pedido com tarifas ainda não liberadas pela Shopee ou com item sem custo cadastrado — o lucro real é
            menor que o mostrado.
          </p>
          {f.conciliacaoAds && (
            <div className="mt-4 print:break-inside-avoid">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Da soma dos pedidos ao lucro líquido do mês
              </p>
              <table className="mt-1 w-full max-w-md tabular-nums">
                <tbody>
                  <Linha rotulo="Soma do lucro dos pedidos" valor={f.conciliacaoAds.lucroDosPedidos} />
                  <Linha rotulo="(+) ADS rateado nos pedidos" valor={f.conciliacaoAds.adsDosPedidos} />
                  <Linha rotulo="(−) Anúncios (ADS) do resultado do mês" valor={-f.conciliacaoAds.adsDoMes} />
                  <Linha rotulo="= Lucro líquido do mês" valor={f.dre.lucroLiquido} forte divisor />
                </tbody>
              </table>
            </div>
          )}
        </Secao>

        {f.naoReceita.length > 0 && (
          <Secao titulo={`Cancelados e devolvidos (${f.naoReceita.length})`} subtitulo="Não entram na receita do mês">
            <Tabela
              compacta
              cabecalho={["Pedido", "Data", "Situação", ...(temNotas ? ["NF"] : []), "Valor (R$)"]}
              alinharDireitaDesde={3}
              linhas={f.naoReceita.map((p) => [
                <span key="n" className="whitespace-nowrap font-mono text-[0.92em]">
                  {p.numero}
                </span>,
                data.format(p.data),
                p.status,
                ...(temNotas ? [p.nf?.numero ?? "—"] : []),
                num(p.vendas),
              ])}
              rodape={["Total", "", "", ...(temNotas ? [""] : []), num(f.naoReceita.reduce((a, p) => a + p.vendas, 0))]}
            />
          </Secao>
        )}

        {f.produtos.length > 0 && (
          <Secao titulo="Produtos vendidos" subtitulo="Taxas e frete de cada pedido rateados pela participação do item">
            <Tabela
              compacta
              cabecalho={["SKU", "Produto", "Unid.", "Vendas (R$)", "CMV (R$)", "Lucro (R$)", "Margem"]}
              alinharDireitaDesde={2}
              linhas={f.produtos.map((p) => [
                <span key="s" className="whitespace-nowrap font-mono text-[0.92em]">
                  {p.sku}
                  {p.unidadesSemCusto > 0 && <span className="text-warning"> *</span>}
                </span>,
                p.nome,
                p.unidades.toLocaleString("pt-BR"),
                num(p.vendas),
                num(p.cmv),
                num(p.lucro),
                pct(p.margem),
              ])}
              rodape={[
                "Total",
                "",
                f.produtos.reduce((a, p) => a + p.unidades, 0).toLocaleString("pt-BR"),
                num(totaisProdutos.vendas),
                num(totaisProdutos.cmv),
                num(totaisProdutos.lucro),
                pct(totaisProdutos.vendas === 0 ? 0 : (totaisProdutos.lucro / totaisProdutos.vendas) * 100),
              ]}
            />
          </Secao>
        )}

      </article>
    </div>
  );
}

function somar(pedidos: LinhaDePedido[]) {
  const s = (f: (p: LinhaDePedido) => number) => pedidos.reduce((acc, p) => acc + f(p), 0);
  return {
    vendas: s((p) => p.vendas),
    descontos: s((p) => p.descontos),
    taxas: s((p) => p.comissao + p.tarifas),
    frete: s((p) => p.frete),
    ads: s((p) => p.ads),
    custos: s((p) => p.cmv + p.embalagemOperacional + p.outros),
    impostos: s((p) => p.impostos),
    lucro: s((p) => p.lucro),
    repasse: s((p) => p.repasse ?? 0),
  };
}

function Secao({
  titulo,
  subtitulo,
  quebraAntes,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  quebraAntes?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`mt-7 ${quebraAntes ? "print:break-before-page" : "print:break-inside-avoid"}`}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">{titulo}</h2>
      {subtitulo && <p className="text-[11px] text-muted-foreground">{subtitulo}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
  divisor,
  destaque,
}: {
  rotulo: string;
  valor: number;
  forte?: boolean;
  divisor?: boolean;
  destaque?: boolean;
}) {
  return (
    <tr className={divisor ? "border-t border-border" : undefined}>
      <td className={`py-1 ${forte ? "font-semibold" : "text-muted-foreground"}`}>{rotulo}</td>
      <td
        className={`py-1 text-right ${forte ? "font-semibold" : ""} ${
          destaque ? (valor < 0 ? "text-destructive" : "text-success") : ""
        }`}
      >
        {brl(valor)}
      </td>
    </tr>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="font-semibold tabular-nums">{valor}</dd>
      {nota && <dd className="text-[11px] text-muted-foreground">{nota}</dd>}
    </div>
  );
}

function Tabela({
  cabecalho,
  linhas,
  rodape,
  alinharDireitaDesde,
  compacta,
}: {
  cabecalho: string[];
  linhas: ReactNode[][];
  rodape?: ReactNode[];
  alinharDireitaDesde: number;
  compacta?: boolean;
}) {
  const alinhamento = (i: number) => (i >= alinharDireitaDesde ? "text-right" : "text-left");
  const celula = compacta ? "px-1.5 py-1" : "px-2 py-1.5";
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className={`w-full border-collapse tabular-nums ${compacta ? "text-[11px] print:text-[7.5pt]" : ""}`}>
        <thead>
          <tr className="border-b border-foreground/70">
            {cabecalho.map((c, i) => (
              <th key={c} className={`${celula} ${alinhamento(i)} whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, r) => (
            <tr key={r} className="border-b border-border/60 print:break-inside-avoid">
              {l.map((v, i) => (
                <td key={i} className={`${celula} ${alinhamento(i)} ${i >= alinharDireitaDesde ? "whitespace-nowrap" : ""}`}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
          {/* Total como última linha do corpo, não <tfoot>: na impressão o
              navegador repete o rodapé em cada página, e o total geral
              parecia subtotal da página. */}
          {rodape && (
            <tr className="border-t-2 border-foreground/70 font-semibold print:break-inside-avoid">
              {rodape.map((v, i) => (
                <td key={i} className={`${celula} ${alinhamento(i)} whitespace-nowrap`}>
                  {v}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
