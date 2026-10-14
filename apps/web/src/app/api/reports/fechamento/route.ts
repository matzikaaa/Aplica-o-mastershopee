import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { mesAnterior, mesValido, montarFechamentoMensal } from "@/lib/fechamento-mensal";

/**
 * A planilha do fechamento mensal — as mesmas informações do documento, em
 * abas, para o contador trabalhar: valores como número (não texto), datas
 * como data, e os totais como fórmulas SOMA que ele pode auditar.
 */

const MOEDA = '#,##0.00;[Red]-#,##0.00';
const PORCENTAGEM = '0.00"%"';
const DATA_HORA = "dd/mm/yyyy hh:mm";

type Celula = string | number | null | { f: string; v: number } | { data: Date };

/**
 * Data para o Excel no relógio do vendedor. O Excel não tem fuso: grava-se o
 * número de série do horário de Brasília, senão a venda das 22h apareceria
 * à 1h do dia seguinte.
 */
function serialExcel(instante: Date, timezone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const parede = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return parede / 86_400_000 + 25_569;
}

function aba(
  linhas: Celula[][],
  opcoes: {
    larguras: number[];
    moeda?: number[];
    porcentagem?: number[];
    /** Quantas linhas de dados o filtro cobre, abaixo do cabeçalho — nunca o total. */
    filtro?: number;
    timezone: string;
  },
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxCol = 0;
  linhas.forEach((linha, r) => {
    linha.forEach((v, c) => {
      if (v === null || v === "") return;
      const ref = XLSX.utils.encode_cell({ r, c });
      if (typeof v === "number") {
        const z = opcoes.moeda?.includes(c) ? MOEDA : opcoes.porcentagem?.includes(c) ? PORCENTAGEM : undefined;
        ws[ref] = { t: "n", v, ...(z ? { z } : {}) };
      } else if (typeof v === "string") {
        ws[ref] = { t: "s", v };
      } else if ("f" in v) {
        // Com o valor junto: sem ele, a biblioteca descarta a célula de fórmula.
        ws[ref] = { t: "n", f: v.f, v: v.v, z: MOEDA };
      } else {
        ws[ref] = { t: "n", v: serialExcel(v.data, opcoes.timezone), z: DATA_HORA };
      }
      maxCol = Math.max(maxCol, c);
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(linhas.length - 1, 0), c: maxCol } });
  ws["!cols"] = opcoes.larguras.map((wch) => ({ wch }));
  // O filtro para no último pedido: com o total dentro dele, ordenar por
  // uma coluna levava a linha de total para o meio da lista.
  if (opcoes.filtro) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: opcoes.filtro, c: maxCol } }) };
  }
  return ws;
}

/**
 * Linha em branco e a linha de total, com SOMA nas colunas indicadas sobre as
 * linhas de dados (2..n no Excel). A fórmula fica para o contador auditar; o
 * valor vai junto porque é o que aparece antes de a planilha recalcular. A
 * linha em branco separa o total dos dados para ordenar e filtrar.
 */
function totalComSoma(dados: Celula[][], colunas: number, comSoma: number[], rotulo = "Total"): Celula[][] {
  const total = Array.from({ length: colunas }, (_, c): Celula => {
    if (c === 0) return rotulo;
    if (!comSoma.includes(c) || dados.length === 0) return null;
    const col = XLSX.utils.encode_col(c);
    const soma = dados.reduce((acc, l) => acc + (typeof l[c] === "number" ? (l[c] as number) : 0), 0);
    return { f: `SUM(${col}2:${col}${dados.length + 1})`, v: Number(soma.toFixed(2)) };
  });
  return [[], total];
}

/** Célula da linha de total (a última), para trocar o formato de contagem. */
function formatoInteiro(ws: XLSX.WorkSheet, linhas: number, colunas: number[]) {
  for (const c of colunas) {
    const cel = ws[XLSX.utils.encode_cell({ r: linhas - 1, c })];
    if (cel) cel.z = "0";
  }
}

export async function GET(request: Request) {
  const { workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  if (!permissions.canUseAdvancedReports().allowed) {
    return NextResponse.json({ error: "A planilha do fechamento faz parte do plano Pro." }, { status: 403 });
  }

  const pedido = new URL(request.url).searchParams.get("mes") ?? undefined;
  const mes = mesValido(pedido) ? pedido : mesAnterior(workspace.timezone);
  const f = await montarFechamentoMensal(workspace.id, mes);
  const tz = workspace.timezone;
  const dataCurta = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: tz });

  // ── Resumo ──────────────────────────────────────────────────────────
  const resumo: Celula[][] = [
    [`Fechamento mensal — ${f.rotuloMes}`],
    ["Empresa", f.empresa.razaoSocial ?? f.empresa.nome],
    ["CNPJ/CPF", f.empresa.documento ?? "não informado"],
    ["Regime tributário", f.empresa.regime ?? "não informado"],
    ["Período", `${dataCurta.format(f.periodo.from)} a ${dataCurta.format(f.periodo.to)}${f.emAndamento ? " (em andamento)" : ""}`],
    ["Gerado em", { data: f.geradoEm }],
    [],
    ["Resultado do mês", "R$"],
    ["Vendas brutas (preço dos produtos)", f.dre.vendasBrutas],
    ["(−) Descontos concedidos", -f.dre.descontos],
    ["(−) Devoluções e reembolsos", -f.dre.reembolsos],
    ["= Receita líquida de vendas", f.dre.receitaLiquida],
    ["(−) CMV — custo dos produtos vendidos", -f.dre.cmv],
    ["(−) Embalagem e custo operacional", -f.dre.embalagemOperacional],
    ["= Lucro bruto", f.dre.lucroBruto],
    ["(−) Comissões do marketplace", -f.dre.comissoes],
    ["(−) Outras tarifas do marketplace", -f.dre.tarifas],
    ["(−) Frete pago pelo vendedor", -f.dre.frete],
    ["(−) Anúncios (ADS)", -f.dre.ads],
    ["(−) Impostos (pela alíquota cadastrada em Custos)", -f.dre.impostos],
    ["(−) Outros custos", -f.dre.outros],
    ["= Lucro líquido", f.dre.lucroLiquido],
    ["Margem líquida sobre as vendas (%)", f.dre.margem],
    [],
    ["Números do mês"],
    ["Pedidos válidos", f.numeros.pedidos],
    ["Unidades vendidas", f.numeros.unidades],
    ["Ticket médio", f.numeros.ticketMedio],
    ["Pedidos cancelados (fora da receita)", f.numeros.cancelados.quantidade],
    ["Valor dos cancelados", f.numeros.cancelados.valor],
    ["Pedidos devolvidos ou reembolsados", f.numeros.devolvidos.quantidade],
    ["Valor dos devolvidos", f.numeros.devolvidos.valor],
    ["Repasse confirmado pela Shopee", f.repasses.confirmado],
    ["Pedidos com repasse confirmado", f.repasses.pedidosConfirmados],
    ["Pedidos com repasse a liberar", f.repasses.pedidosPendentes],
    ["Receita líquida acumulada em 12 meses", f.receita12Meses],
    [],
    // A aba Pedidos soma o ADS rateado; quando há gasto por campanha, o
    // resultado usa o da campanha, e esta ponte fecha uma soma na outra.
    ...(f.conciliacaoAds
      ? [
          ["Da soma da aba Pedidos ao lucro líquido"] as Celula[],
          ["Soma do lucro dos pedidos", f.conciliacaoAds.lucroDosPedidos] as Celula[],
          ["(+) ADS rateado nos pedidos", f.conciliacaoAds.adsDosPedidos] as Celula[],
          ["(−) Anúncios (ADS) do resultado do mês", -f.conciliacaoAds.adsDoMes] as Celula[],
          ["= Lucro líquido do mês", f.dre.lucroLiquido] as Celula[],
          [] as Celula[],
        ]
      : []),
    ...(f.atencao.length > 0 ? [["Pontos de atenção"] as Celula[], ...f.atencao.map((a) => ["•", a] as Celula[]), []] : []),
    [
      "Observação",
      "Relatório gerencial. Não substitui a escrituração contábil nem as notas fiscais emitidas; custos, embalagem e alíquota de imposto são os cadastrados pela empresa.",
    ],
  ];
  // Moeda só nas linhas de valor (contagens ficam como inteiro).
  const resumoWs = aba(resumo, { larguras: [48, 22], timezone: tz });
  const contagens = new Set([
    "Pedidos válidos",
    "Unidades vendidas",
    "Pedidos cancelados (fora da receita)",
    "Pedidos devolvidos ou reembolsados",
    "Pedidos com repasse confirmado",
    "Pedidos com repasse a liberar",
  ]);
  resumo.forEach((linha, r) => {
    const cel = resumoWs[XLSX.utils.encode_cell({ r, c: 1 })];
    if (!cel || cel.t !== "n" || cel.f || cel.z === DATA_HORA) return;
    if (contagens.has(String(linha[0]))) cel.z = "0";
    else if (String(linha[0]).startsWith("Margem")) cel.z = PORCENTAGEM;
    else cel.z = MOEDA;
  });

  // ── Pedidos ─────────────────────────────────────────────────────────
  const cabecalhoPedidos = [
    "Pedido",
    "Data",
    "Loja",
    "Marketplace",
    "Situação",
    "Itens",
    "Unidades",
    "Vendas brutas",
    "Descontos",
    "Comissão",
    "Outras tarifas",
    "Frete pago pelo vendedor",
    "ADS",
    "CMV",
    "Embalagem e operacional",
    "Outros custos",
    "Impostos",
    "Reembolsos",
    "Lucro líquido",
    "Margem (%)",
    "Repasse Shopee",
    "Observações",
  ];
  const linhaDePedido = (p: (typeof f.pedidos)[number]): Celula[] => [
    p.numero,
    { data: p.data },
    p.loja,
    p.marketplace,
    p.status,
    p.itens,
    p.unidades,
    p.vendas,
    p.descontos,
    p.comissao,
    p.tarifas,
    p.frete,
    p.ads,
    p.cmv,
    p.embalagemOperacional,
    p.outros,
    p.impostos,
    p.reembolsos,
    p.lucro,
    p.margem,
    p.repasse,
    [
      p.taxasEstimadas ? "tarifas ainda não liberadas pela Shopee" : "",
      p.semCusto ? "item sem custo cadastrado" : "",
    ]
      .filter(Boolean)
      .join("; "),
  ];
  const dadosPedidos = f.pedidos.map(linhaDePedido);
  const pedidosLinhas: Celula[][] = [cabecalhoPedidos, ...dadosPedidos];
  const colunasDeValor = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20];
  if (dadosPedidos.length > 0) pedidosLinhas.push(...totalComSoma(dadosPedidos, cabecalhoPedidos.length, [6, ...colunasDeValor]));
  const pedidosWs = aba(pedidosLinhas, {
    larguras: [22, 16, 22, 13, 12, 34, 9, 13, 11, 11, 12, 13, 10, 11, 13, 11, 11, 11, 13, 10, 13, 40],
    moeda: colunasDeValor,
    porcentagem: [19],
    filtro: dadosPedidos.length,
    timezone: tz,
  });
  // A soma de unidades é contagem, não moeda.
  formatoInteiro(pedidosWs, pedidosLinhas.length, [6]);

  // ── Cancelados e devolvidos ─────────────────────────────────────────
  const dadosNaoReceita = f.naoReceita.map(
    (p) => [p.numero, { data: p.data }, p.loja, p.status, p.itens, p.vendas] as Celula[],
  );
  const naoReceita: Celula[][] = [["Pedido", "Data", "Loja", "Situação", "Itens", "Valor"], ...dadosNaoReceita];
  if (dadosNaoReceita.length > 0) naoReceita.push(...totalComSoma(dadosNaoReceita, 6, [5]));

  // ── Produtos ────────────────────────────────────────────────────────
  // Rateado ao centavo a partir dos pedidos: o total desta aba é o da aba Pedidos.
  const dadosProdutos = f.produtos.map(
    (p) => [p.sku, p.nome, p.unidades, p.vendas, p.cmv, p.lucro, p.margem, p.unidadesSemCusto] as Celula[],
  );
  const produtos: Celula[][] = [
    ["SKU", "Produto", "Unidades", "Vendas brutas", "CMV", "Lucro líquido", "Margem (%)", "Unidades sem custo"],
    ...dadosProdutos,
  ];
  if (dadosProdutos.length > 0) produtos.push(...totalComSoma(dadosProdutos, 8, [2, 3, 4, 5, 7]));
  const produtosWs = aba(produtos, {
    larguras: [18, 40, 10, 14, 13, 14, 11, 12],
    moeda: [3, 4, 5],
    porcentagem: [6],
    filtro: dadosProdutos.length,
    timezone: tz,
  });
  formatoInteiro(produtosWs, produtos.length, [2, 7]);

  // ── 12 meses ────────────────────────────────────────────────────────
  const dadosDoze = f.ultimos12Meses.map(
    (m) => [m.rotulo, m.pedidos, m.vendasBrutas, m.descontos, m.reembolsos, m.receitaLiquida, m.lucro] as Celula[],
  );
  const doze: Celula[][] = [
    ["Mês", "Pedidos", "Vendas brutas", "Descontos", "Reembolsos", "Receita líquida", "Lucro líquido"],
    ...dadosDoze,
  ];
  // Lucro fica fora do acumulado, como no documento: mês sem métricas não tem
  // lucro, e a soma pareceria completa sem ser.
  doze.push(...totalComSoma(dadosDoze, 7, [1, 2, 3, 4, 5], "Acumulado 12 meses"));
  const dozeWs = aba(doze, { larguras: [20, 10, 14, 12, 12, 15, 14], moeda: [2, 3, 4, 5, 6], timezone: tz });
  // Soma de pedidos é contagem.
  formatoInteiro(dozeWs, doze.length, [1]);

  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, resumoWs, "Resumo");
  XLSX.utils.book_append_sheet(livro, pedidosWs, "Pedidos");
  XLSX.utils.book_append_sheet(
    livro,
    aba(naoReceita, { larguras: [22, 16, 22, 14, 34, 13], moeda: [5], filtro: dadosNaoReceita.length, timezone: tz }),
    "Cancelados e devolvidos",
  );
  XLSX.utils.book_append_sheet(livro, produtosWs, "Produtos");
  XLSX.utils.book_append_sheet(livro, dozeWs, "12 meses");
  if (f.porLoja.length > 1) {
    const dadosLojas = f.porLoja.map((l) => [l.loja, l.marketplace, l.pedidos, l.vendas, l.lucro] as Celula[]);
    const lojas: Celula[][] = [
      ["Loja", "Marketplace", "Pedidos", "Vendas brutas", "Lucro líquido"],
      ...dadosLojas,
      ...totalComSoma(dadosLojas, 5, [2, 3, 4]),
    ];
    const lojasWs = aba(lojas, { larguras: [28, 14, 10, 14, 14], moeda: [3, 4], timezone: tz });
    formatoInteiro(lojasWs, lojas.length, [2]);
    XLSX.utils.book_append_sheet(livro, lojasWs, "Por loja");
  }

  const buffer = XLSX.write(livro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fechamento-${mes}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
