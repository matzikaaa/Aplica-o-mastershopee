import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { calcularPedido, prisma } from "@mastershopee/database";
import { ORDER_STATUS_LABELS, costIsUnknown, nomeDoMarketplace } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { SELECAO_DE_PEDIDO, lerFiltros, whereDosFiltros } from "@/lib/order-filters";

/**
 * §26 — exportação de pedidos (CSV ou XLSX via ?format=), com os mesmos
 * filtros da tela de Pedidos.
 *
 * O CSV é para o Excel em português abrir com dois cliques: separador ";",
 * vírgula decimal, data dd/mm/aaaa e BOM para os acentos. O formato anterior
 * (vírgula como separador, ponto decimal) jogava tudo na coluna A. E o lucro
 * vem de `calcularPedido`, o mesmo do detalhe do pedido — a versão anterior
 * ignorava descontos e reembolsos e não batia com a tela.
 */

const LOTE = 500;

type Pedido = Awaited<ReturnType<typeof buscarLote>>[number];

function buscarLote(where: ReturnType<typeof whereDosFiltros>, cursor?: string) {
  return prisma.order.findMany({
    where,
    select: SELECAO_DE_PEDIDO,
    orderBy: [{ orderedAt: "desc" }, { id: "desc" }],
    take: LOTE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}

const COLUNAS = [
  "Pedido",
  "Data",
  "Marketplace",
  "Status",
  "Itens",
  "Venda",
  "Descontos",
  "Comissão",
  "Taxas",
  "Frete pago por você",
  "ADS",
  "Custo dos produtos",
  "Embalagem",
  "Custo operacional",
  "Outros custos",
  "Imposto",
  "Reembolsos",
  "Lucro líquido",
  "Margem (%)",
  "Observações",
] as const;

type Celula = string | number;

function linha(order: Pedido, timezone: string): { celulas: Celula[]; prejuizo: boolean } {
  const r = calcularPedido(order);
  const n = (m: { toDecimal(): { toFixed(casas: number): string } }) => Number(m.toDecimal().toFixed(2));
  const obs: string[] = [];
  if (order.items.some((i) => costIsUnknown(i.unitCostSnapshot))) obs.push("custo não cadastrado: lucro real é menor");
  if (order.feesAreEstimated) obs.push("taxas da Shopee ainda não liberadas");
  const celulas: Celula[] = [
    order.externalOrderId,
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(order.orderedAt),
    nomeDoMarketplace(order.marketplace),
    ORDER_STATUS_LABELS[order.status] ?? order.status,
    order.items.map((i) => `${i.quantity}x ${i.externalSku}`).join(", "),
    n(r.grossRevenue),
    n(r.discounts),
    n(r.commission),
    n(r.marketplaceFees),
    n(r.shipping),
    n(r.adSpend),
    n(r.productCost),
    n(r.packaging),
    n(r.operational),
    n(r.otherCosts),
    n(r.taxes),
    n(r.refunds),
    n(r.netProfit),
    Number(r.marginPercent.toFixed(2)),
    obs.join("; "),
  ];
  // Pelo valor exato, não pelo arredondado: -R$ 0,004 também é prejuízo na tela.
  return { celulas, prejuizo: r.netProfit.isNegative() };
}

const numeroBR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/**
 * Uma célula de CSV. Texto que começa com = + - @ vira fórmula no Excel
 * (injeção de CSV): SKU e título vêm de fora, então ganham um apóstrofo.
 * Números são nossos e saem formatados — um "-12,50" é prejuízo, não fórmula.
 */
function celulaCsv(v: Celula): string {
  let s = typeof v === "number" ? numeroBR.format(v) : v;
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const { workspace } = await requireWorkspace();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filtros = lerFiltros(Object.fromEntries(url.searchParams));
  const where = whereDosFiltros(workspace.id, workspace.timezone, filtros);
  const soPrejuizo = filtros.problema === "prejuizo";

  const permissions = await getPlanPermissionService(workspace.id);
  if (format === "xlsx" && !permissions.canUseAdvancedReports().allowed) {
    return NextResponse.json({ error: "Exportação XLSX requer o plano Pro." }, { status: 403 });
  }

  const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: workspace.timezone }).format(new Date());
  const nome = `pedidos-${hoje}${soPrejuizo ? "-prejuizo" : ""}`;

  async function* linhas(): AsyncGenerator<Celula[]> {
    let cursor: string | undefined;
    for (;;) {
      const lote = await buscarLote(where, cursor);
      for (const order of lote) {
        const { celulas, prejuizo } = linha(order, workspace.timezone);
        // Mesma regra da tela: "com prejuízo" é lucro negativo pelo motor.
        if (soPrejuizo && !prejuizo) continue;
        yield celulas;
      }
      if (lote.length < LOTE) return;
      cursor = lote[lote.length - 1]!.id;
    }
  }

  if (format === "xlsx") {
    const rows: Celula[][] = [[...COLUNAS]];
    for await (const l of linhas()) rows.push(l);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Pedidos");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      },
    });
  }

  // Em lotes e em fluxo: um histórico grande não precisa caber inteiro na
  // memória da função, nem estourar o limite de resposta da Vercel.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`﻿${COLUNAS.map(celulaCsv).join(";")}\r\n`));
        for await (const l of linhas()) controller.enqueue(encoder.encode(`${l.map(celulaCsv).join(";")}\r\n`));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
