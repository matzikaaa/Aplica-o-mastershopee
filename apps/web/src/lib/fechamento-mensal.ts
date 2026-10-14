import Decimal from "decimal.js";
import {
  calcularItensDoPedido,
  calcularPedido,
  countsAsRevenue,
  prisma,
  type OrderStatus,
} from "@mastershopee/database";
import {
  ORDER_STATUS_LABELS,
  REGIMES_TRIBUTARIOS,
  chaveDoDia,
  costIsUnknown,
  dataDoDia,
  formatarDocumento,
  nomeDoMarketplace,
  periodo,
  somarDias,
  type DateRange,
} from "@mastershopee/shared";

/**
 * O fechamento de um mês, como o contador pede.
 *
 * Uma montagem só, usada pelo documento para imprimir e pela planilha: os
 * dois nunca podem discordar. O resumo é somado a partir dos mesmos pedidos
 * que aparecem listados — o contador confere linha a linha, e a soma tem que
 * fechar. É um relatório gerencial: a base fiscal oficial continua sendo a
 * das notas fiscais emitidas, e o documento diz isso.
 */

export interface LinhaDePedido {
  id: string;
  numero: string;
  data: Date;
  loja: string;
  marketplace: string;
  status: string;
  contaNaReceita: boolean;
  itens: string;
  unidades: number;
  vendas: number;
  descontos: number;
  comissao: number;
  tarifas: number;
  frete: number;
  ads: number;
  cmv: number;
  embalagemOperacional: number;
  impostos: number;
  reembolsos: number;
  outros: number;
  lucro: number;
  margem: number;
  /** Valor que a Shopee informou ter repassado (escrow); null quando não há. */
  repasse: number | null;
  taxasEstimadas: boolean;
  semCusto: boolean;
}

export interface LinhaDeProduto {
  sku: string;
  nome: string;
  unidades: number;
  vendas: number;
  cmv: number;
  lucro: number;
  margem: number;
  unidadesSemCusto: number;
}

export interface LinhaDoAno {
  mes: string;
  rotulo: string;
  pedidos: number;
  vendasBrutas: number;
  descontos: number;
  reembolsos: number;
  receitaLiquida: number;
  lucro: number | null;
}

export interface FechamentoMensal {
  empresa: { nome: string; razaoSocial: string | null; documento: string | null; regime: string | null };
  mes: string;
  rotuloMes: string;
  periodo: DateRange;
  emAndamento: boolean;
  geradoEm: Date;
  dre: {
    vendasBrutas: number;
    descontos: number;
    reembolsos: number;
    receitaLiquida: number;
    cmv: number;
    embalagemOperacional: number;
    lucroBruto: number;
    comissoes: number;
    tarifas: number;
    frete: number;
    ads: number;
    impostos: number;
    outros: number;
    lucroLiquido: number;
    margem: number;
  };
  numeros: {
    pedidos: number;
    unidades: number;
    ticketMedio: number;
    cancelados: { quantidade: number; valor: number };
    devolvidos: { quantidade: number; valor: number };
  };
  repasses: { confirmado: number; pedidosConfirmados: number; pedidosPendentes: number };
  /**
   * Ponte entre a soma da lista de pedidos e o lucro líquido do mês, quando
   * o ADS por campanha substitui o rateio por pedido; null quando batem.
   */
  conciliacaoAds: { lucroDosPedidos: number; adsDosPedidos: number; adsDoMes: number } | null;
  porLoja: { loja: string; marketplace: string; pedidos: number; vendas: number; lucro: number }[];
  ultimos12Meses: LinhaDoAno[];
  receita12Meses: number;
  pedidos: LinhaDePedido[];
  naoReceita: LinhaDePedido[];
  produtos: LinhaDeProduto[];
  atencao: string[];
}

const n = (v: Decimal) => Number(v.toFixed(2));
const dec = (v: unknown) => new Decimal(v === null || v === undefined ? 0 : String(v));

/**
 * Reparte um valor já em centavos entre os itens do pedido: cada parte
 * arredondada, e o centavo que sobra ou falta fica com a maior. Assim a soma
 * da tabela de produtos é, ao centavo, a soma da lista de pedidos.
 */
function repartir(total: number, partes: Decimal[]): number[] {
  const arredondadas = partes.map(n);
  const resto = arredondadas.reduce((acc, v) => acc.minus(v), new Decimal(total));
  if (!resto.isZero() && partes.length > 0) {
    const maior = partes.reduce((m, p, i) => (p.abs().gt(partes[m]!.abs()) ? i : m), 0);
    arredondadas[maior] = n(resto.plus(arredondadas[maior]!));
  }
  return arredondadas;
}

/** "2026-09" do mês anterior ao de hoje, no fuso dado — o mês a fechar. */
export function mesAnterior(timezone: string, agora = new Date()): string {
  const hoje = chaveDoDia(agora, timezone);
  return somarDias(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7);
}

export function mesValido(mes: string | undefined): mes is string {
  return Boolean(mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes));
}

/** "Setembro de 2026" — maiúscula só no começo, como se escreve. */
export function rotuloDoMes(mes: string): string {
  const r = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    dataDoDia(`${mes}-01`),
  );
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function ultimoDia(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const proximo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return somarDias(`${proximo}-01`, -1);
}

export async function montarFechamentoMensal(workspaceId: string, mes: string): Promise<FechamentoMensal> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true, legalName: true, taxId: true, taxRegime: true, timezone: true },
  });
  const tz = ws.timezone;
  const fromKey = `${mes}-01`;
  const toKey = ultimoDia(mes);
  const range = periodo(fromKey, toKey, tz);
  const hoje = chaveDoDia(new Date(), tz);

  const orders = await prisma.order.findMany({
    where: { workspaceId, orderedAt: { gte: range.from, lte: range.to } },
    orderBy: { orderedAt: "asc" },
    select: {
      id: true,
      externalOrderId: true,
      orderedAt: true,
      marketplace: true,
      status: true,
      feesAreEstimated: true,
      grossAmount: true,
      discountAmount: true,
      commissionAmount: true,
      marketplaceFeeAmount: true,
      shippingSubsidizedByMerchant: true,
      taxAmount: true,
      adSpendAttributed: true,
      marketplaceAccount: { select: { displayName: true } },
      refunds: { select: { amount: true } },
      items: {
        select: {
          productId: true,
          externalSku: true,
          quantity: true,
          unitPrice: true,
          unitCostSnapshot: true,
          packagingCostSnapshot: true,
          operationalCostSnapshot: true,
          otherCostsSnapshot: true,
          taxPercentSnapshot: true,
          product: { select: { sku: true, name: true } },
        },
      },
    },
  });

  // O valor que a Shopee diz ter repassado, de dentro do payload guardado:
  // é o número que aparece no extrato, e o que o contador usa para conciliar.
  const repassesBrutos = await prisma.$queryRaw<{ id: string; repasse: string | null }[]>`
    SELECT "id", ("rawPayload"->'escrow'->'order_income'->>'escrow_amount') AS repasse
    FROM "Order"
    WHERE "workspaceId" = ${workspaceId} AND "orderedAt" >= ${range.from} AND "orderedAt" <= ${range.to}`;
  const repassePorPedido = new Map<string, number>();
  for (const r of repassesBrutos) {
    const v = r.repasse === null ? NaN : Number(r.repasse);
    if (Number.isFinite(v) && v > 0) repassePorPedido.set(r.id, v);
  }

  const pedidos: LinhaDePedido[] = [];
  const naoReceita: LinhaDePedido[] = [];
  const t = {
    vendas: new Decimal(0),
    descontos: new Decimal(0),
    reembolsos: new Decimal(0),
    receitaLiquida: new Decimal(0),
    cmv: new Decimal(0),
    embalagemOperacional: new Decimal(0),
    lucroBruto: new Decimal(0),
    comissoes: new Decimal(0),
    tarifas: new Decimal(0),
    frete: new Decimal(0),
    adsDosPedidos: new Decimal(0),
    impostos: new Decimal(0),
    outros: new Decimal(0),
    lucroDosPedidos: new Decimal(0),
  };
  const adsPorDia = new Map<string, Decimal>();
  const porLoja = new Map<string, { loja: string; marketplace: string; pedidos: number; vendas: Decimal; lucro: Decimal }>();
  const porProduto = new Map<string, { sku: string; nome: string; unidades: number; vendas: Decimal; cmv: Decimal; lucro: Decimal; semCusto: number }>();
  let unidades = 0;
  let itensSemCusto = 0;
  let pedidosEstimados = 0;
  const cancelados = { quantidade: 0, valor: new Decimal(0) };
  const devolvidos = { quantidade: 0, valor: new Decimal(0) };
  let repasseConfirmado = new Decimal(0);
  let pedidosConfirmados = 0;
  let pedidosPendentes = 0;

  for (const o of orders) {
    const r = calcularPedido(o);
    const receita = countsAsRevenue(o.status as OrderStatus);
    const semCusto = o.items.some((i) => costIsUnknown(i.unitCostSnapshot));
    const repasse = repassePorPedido.get(o.id) ?? null;

    // Em centavos, e o lucro da linha como a conta das próprias colunas. O
    // contador soma a coluna: arredondar só no total fazia a soma da lista
    // diferir do resumo em centavos — e cada centavo vira pergunta.
    const c = {
      vendas: n(r.grossRevenue.toDecimal()),
      descontos: n(r.discounts.toDecimal()),
      comissao: n(r.commission.toDecimal()),
      tarifas: n(r.marketplaceFees.toDecimal()),
      frete: n(r.shipping.toDecimal()),
      ads: n(r.adSpend.toDecimal()),
      cmv: n(r.productCost.toDecimal()),
      embalagemOperacional: n(r.packaging.toDecimal().plus(r.operational.toDecimal())),
      impostos: n(r.taxes.toDecimal()),
      reembolsos: n(r.refunds.toDecimal()),
      outros: n(r.otherCosts.toDecimal()),
    };
    const lucroDaLinha = n(
      new Decimal(c.vendas)
        .minus(c.descontos)
        .minus(c.reembolsos)
        .minus(c.cmv)
        .minus(c.embalagemOperacional)
        .minus(c.comissao)
        .minus(c.tarifas)
        .minus(c.frete)
        .minus(c.ads)
        .minus(c.impostos)
        .minus(c.outros),
    );
    const linha: LinhaDePedido = {
      id: o.id,
      numero: o.externalOrderId,
      data: o.orderedAt,
      loja: o.marketplaceAccount.displayName,
      marketplace: nomeDoMarketplace(o.marketplace),
      status: ORDER_STATUS_LABELS[o.status] ?? o.status,
      contaNaReceita: receita,
      itens: o.items.map((i) => `${i.quantity}x ${i.externalSku}`).join(", "),
      unidades: o.items.reduce((acc, i) => acc + i.quantity, 0),
      ...c,
      lucro: lucroDaLinha,
      margem: c.vendas === 0 ? 0 : Number(new Decimal(lucroDaLinha).dividedBy(c.vendas).times(100).toFixed(2)),
      repasse,
      taxasEstimadas: o.feesAreEstimated,
      semCusto,
    };

    if (!receita) {
      naoReceita.push(linha);
      const alvo = o.status === "CANCELED" ? cancelados : devolvidos;
      alvo.quantidade++;
      alvo.valor = alvo.valor.plus(c.vendas);
      continue;
    }

    pedidos.push(linha);
    unidades += linha.unidades;
    if (o.feesAreEstimated) pedidosEstimados++;
    itensSemCusto += o.items.filter((i) => costIsUnknown(i.unitCostSnapshot)).length;
    if (repasse !== null) {
      repasseConfirmado = repasseConfirmado.plus(repasse);
      pedidosConfirmados++;
    } else if (o.marketplace === "SHOPEE") {
      pedidosPendentes++;
    }

    // Somas das colunas em centavos: o resumo é, exatamente, a soma da lista.
    t.vendas = t.vendas.plus(c.vendas);
    t.descontos = t.descontos.plus(c.descontos);
    t.reembolsos = t.reembolsos.plus(c.reembolsos);
    t.cmv = t.cmv.plus(c.cmv);
    t.embalagemOperacional = t.embalagemOperacional.plus(c.embalagemOperacional);
    t.comissoes = t.comissoes.plus(c.comissao);
    t.tarifas = t.tarifas.plus(c.tarifas);
    t.frete = t.frete.plus(c.frete);
    t.adsDosPedidos = t.adsDosPedidos.plus(c.ads);
    t.impostos = t.impostos.plus(c.impostos);
    t.outros = t.outros.plus(c.outros);
    t.lucroDosPedidos = t.lucroDosPedidos.plus(lucroDaLinha);

    const dia = chaveDoDia(o.orderedAt, tz);
    adsPorDia.set(dia, (adsPorDia.get(dia) ?? new Decimal(0)).plus(c.ads));

    const lojaKey = `${o.marketplace}:${linha.loja}`;
    const loja = porLoja.get(lojaKey) ?? { loja: linha.loja, marketplace: linha.marketplace, pedidos: 0, vendas: new Decimal(0), lucro: new Decimal(0) };
    loja.pedidos++;
    loja.vendas = loja.vendas.plus(c.vendas);
    loja.lucro = loja.lucro.plus(lucroDaLinha);
    porLoja.set(lojaKey, loja);

    const itens = calcularItensDoPedido(o);
    const vendasDosItens = repartir(c.vendas, itens.map((x) => x.resultado.grossRevenue.toDecimal()));
    const cmvDosItens = repartir(c.cmv, itens.map((x) => x.resultado.productCost.toDecimal()));
    const lucroDosItens = repartir(lucroDaLinha, itens.map((x) => x.resultado.netProfit.toDecimal()));
    itens.forEach(({ item }, i) => {
      const chave = item.productId ?? `sku:${item.externalSku}`;
      const p = porProduto.get(chave) ?? {
        sku: item.product?.sku ?? item.externalSku,
        nome: item.product?.name ?? item.externalSku,
        unidades: 0,
        vendas: new Decimal(0),
        cmv: new Decimal(0),
        lucro: new Decimal(0),
        semCusto: 0,
      };
      p.unidades += item.quantity;
      p.vendas = p.vendas.plus(vendasDosItens[i]!);
      p.cmv = p.cmv.plus(cmvDosItens[i]!);
      p.lucro = p.lucro.plus(lucroDosItens[i]!);
      if (costIsUnknown(item.unitCostSnapshot)) p.semCusto += item.quantity;
      porProduto.set(chave, p);
    });
  }

  // ADS do mês pela mesma regra das métricas diárias: no dia em que há gasto
  // por campanha, ele é o gasto do dia (o rateio por pedido é o mesmo
  // dinheiro e somaria duas vezes); sem campanha, vale o rateio.
  const campanhas = await prisma.adSpend.groupBy({
    by: ["date"],
    where: { campaign: { workspaceId }, date: { gte: dataDoDia(fromKey), lte: dataDoDia(toKey) } },
    _sum: { spend: true },
  });
  const campanhaPorDia = new Map(campanhas.map((c) => [c.date.toISOString().slice(0, 10), dec(c._sum.spend)]));
  let ads = new Decimal(0);
  for (const dia of new Set([...adsPorDia.keys(), ...campanhaPorDia.keys()])) {
    const campanha = campanhaPorDia.get(dia);
    ads = ads.plus(campanha && campanha.gt(0) ? campanha : (adsPorDia.get(dia) ?? new Decimal(0)));
  }
  const lucroLiquido = t.lucroDosPedidos.plus(t.adsDosPedidos).minus(ads);
  t.receitaLiquida = t.vendas.minus(t.descontos).minus(t.reembolsos);
  t.lucroBruto = t.receitaLiquida.minus(t.cmv).minus(t.embalagemOperacional);

  const ultimos12Meses = await montarUltimos12Meses(workspaceId, tz, mes, {
    pedidos: pedidos.length,
    vendasBrutas: n(t.vendas),
    descontos: n(t.descontos),
    reembolsos: n(t.reembolsos),
    receitaLiquida: n(t.receitaLiquida),
    lucro: n(lucroLiquido),
  });

  const atencao: string[] = [];
  if (toKey >= hoje) atencao.push("O mês ainda não terminou: os números vão mudar até o fechamento.");
  if (pedidosEstimados > 0) {
    atencao.push(
      `${pedidosEstimados} pedido(s) com tarifas ainda não liberadas pela Shopee: comissão e tarifas entram como zero até o repasse sair, e o lucro real desses pedidos é menor.`,
    );
  }
  if (itensSemCusto > 0) {
    atencao.push(
      `${itensSemCusto} item(ns) vendido(s) sem custo cadastrado: o CMV está incompleto e o lucro, maior que o real.`,
    );
  }
  if (!ads.equals(t.adsDosPedidos)) {
    atencao.push(
      "Há gasto com anúncios lançado por campanha: no resultado do mês ele substitui o rateio por pedido, e por isso a soma do lucro dos pedidos difere do lucro líquido — a conciliação acompanha a lista de pedidos.",
    );
  }
  if (naoReceita.length > 0) {
    atencao.push("Pedidos cancelados, devolvidos ou reembolsos totais não entram na receita; estão listados à parte.");
  }

  const vendas = n(t.vendas);
  return {
    empresa: {
      nome: ws.name,
      razaoSocial: ws.legalName,
      documento: ws.taxId ? formatarDocumento(ws.taxId) : null,
      regime: ws.taxRegime ? (REGIMES_TRIBUTARIOS as Record<string, string>)[ws.taxRegime] ?? null : null,
    },
    mes,
    rotuloMes: rotuloDoMes(mes),
    periodo: range,
    emAndamento: toKey >= hoje,
    geradoEm: new Date(),
    dre: {
      vendasBrutas: vendas,
      descontos: n(t.descontos),
      reembolsos: n(t.reembolsos),
      receitaLiquida: n(t.receitaLiquida),
      cmv: n(t.cmv),
      embalagemOperacional: n(t.embalagemOperacional),
      lucroBruto: n(t.lucroBruto),
      comissoes: n(t.comissoes),
      tarifas: n(t.tarifas),
      frete: n(t.frete),
      ads: n(ads),
      impostos: n(t.impostos),
      outros: n(t.outros),
      lucroLiquido: n(lucroLiquido),
      margem: t.vendas.isZero() ? 0 : Number(lucroLiquido.dividedBy(t.vendas).times(100).toFixed(2)),
    },
    numeros: {
      pedidos: pedidos.length,
      unidades,
      ticketMedio: pedidos.length === 0 ? 0 : Number(t.vendas.dividedBy(pedidos.length).toFixed(2)),
      cancelados: { quantidade: cancelados.quantidade, valor: n(cancelados.valor) },
      devolvidos: { quantidade: devolvidos.quantidade, valor: n(devolvidos.valor) },
    },
    repasses: { confirmado: n(repasseConfirmado), pedidosConfirmados, pedidosPendentes },
    conciliacaoAds: ads.equals(t.adsDosPedidos)
      ? null
      : { lucroDosPedidos: n(t.lucroDosPedidos), adsDosPedidos: n(t.adsDosPedidos), adsDoMes: n(ads) },
    porLoja: [...porLoja.values()]
      .map((l) => ({ ...l, vendas: n(l.vendas), lucro: n(l.lucro) }))
      .sort((a, b) => b.vendas - a.vendas),
    ultimos12Meses,
    receita12Meses: Number(ultimos12Meses.reduce((acc, m) => acc + m.receitaLiquida, 0).toFixed(2)),
    pedidos,
    naoReceita,
    produtos: [...porProduto.values()]
      .map((p) => ({
        sku: p.sku,
        nome: p.nome,
        unidades: p.unidades,
        vendas: n(p.vendas),
        cmv: n(p.cmv),
        lucro: n(p.lucro),
        margem: p.vendas.isZero() ? 0 : Number(p.lucro.dividedBy(p.vendas).times(100).toFixed(2)),
        unidadesSemCusto: p.semCusto,
      }))
      .sort((a, b) => b.vendas - a.vendas),
    atencao,
  };
}

/**
 * Receita mês a mês nos 12 meses que terminam no mês fechado — o que o
 * contador usa para conferir a receita acumulada (RBT12) do Simples.
 *
 * Os meses anteriores vêm de uma soma direta nos pedidos (receita) e das
 * métricas diárias (lucro); o mês fechado usa os números do próprio
 * documento, para o mesmo mês não aparecer com dois valores.
 */
async function montarUltimos12Meses(
  workspaceId: string,
  tz: string,
  mes: string,
  doMes: Omit<LinhaDoAno, "mes" | "rotulo">,
): Promise<LinhaDoAno[]> {
  const meses: string[] = [];
  let cursor = `${mes}-01`;
  for (let i = 0; i < 12; i++) {
    meses.unshift(cursor.slice(0, 7));
    cursor = somarDias(cursor, -1).slice(0, 7) + "-01";
  }
  const inicio = periodo(`${meses[0]}-01`, ultimoDia(mes), tz);

  const receitas = await prisma.$queryRaw<
    { mes: string; pedidos: number; vendas: string | null; descontos: string | null }[]
  >`
    SELECT to_char(("orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS mes,
           count(*)::int AS pedidos,
           sum("grossAmount")::text AS vendas,
           sum("discountAmount")::text AS descontos
    FROM "Order"
    WHERE "workspaceId" = ${workspaceId}
      AND "orderedAt" >= ${inicio.from} AND "orderedAt" <= ${inicio.to}
      AND "status" NOT IN ('CANCELED', 'REFUNDED', 'RETURNED')
    GROUP BY 1`;
  const reembolsos = await prisma.$queryRaw<{ mes: string; valor: string | null }[]>`
    SELECT to_char((o."orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS mes,
           sum(r."amount")::text AS valor
    FROM "Refund" r JOIN "Order" o ON o."id" = r."orderId"
    WHERE o."workspaceId" = ${workspaceId}
      AND o."orderedAt" >= ${inicio.from} AND o."orderedAt" <= ${inicio.to}
      AND o."status" NOT IN ('CANCELED', 'REFUNDED', 'RETURNED')
    GROUP BY 1`;
  const lucros = await prisma.$queryRaw<{ mes: string; lucro: string | null }[]>`
    SELECT to_char("date", 'YYYY-MM') AS mes, sum("netProfit")::text AS lucro
    FROM "DailyMetric"
    WHERE "workspaceId" = ${workspaceId}
      AND "date" >= ${dataDoDia(`${meses[0]}-01`)} AND "date" <= ${dataDoDia(ultimoDia(mes))}
    GROUP BY 1`;

  return meses.map((m) => {
    if (m === mes) return { mes: m, rotulo: rotuloDoMes(m), ...doMes };
    const rec = receitas.find((x) => x.mes === m);
    const vendasBrutas = Number(rec?.vendas ?? 0);
    const descontos = Number(rec?.descontos ?? 0);
    const reemb = Number(reembolsos.find((x) => x.mes === m)?.valor ?? 0);
    const lucro = lucros.find((x) => x.mes === m)?.lucro;
    return {
      mes: m,
      rotulo: rotuloDoMes(m),
      pedidos: rec?.pedidos ?? 0,
      vendasBrutas: Number(vendasBrutas.toFixed(2)),
      descontos: Number(descontos.toFixed(2)),
      reembolsos: Number(reemb.toFixed(2)),
      receitaLiquida: Number((vendasBrutas - descontos - reemb).toFixed(2)),
      lucro: lucro === undefined || lucro === null ? null : Number(Number(lucro).toFixed(2)),
    };
  });
}
