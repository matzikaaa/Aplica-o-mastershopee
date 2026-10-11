import {
  revenueOrdersWhere,
  unknownCostWhere,
  type MarketplaceType,
  type OrderStatus,
  type Prisma,
} from "@mastershopee/database";
import { resolveDateRange, type DateRangePreset } from "@mastershopee/shared";

/**
 * Filtros da lista de pedidos, lidos da URL.
 *
 * Moram aqui, e não na página, porque a exportação precisa devolver
 * exatamente o que a tela mostra: "exportei os pedidos com prejuízo de
 * setembro" tem que dar o mesmo conjunto que o vendedor estava olhando.
 */

const PERIODOS: DateRangePreset[] = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
  "last_month",
  "all_time",
];
const STATUS: OrderStatus[] = ["CREATED", "PAID", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED", "RETURNED"];
const MARKETPLACES: MarketplaceType[] = ["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"];

export const PROBLEMAS = {
  prejuizo: "Com prejuízo",
  sem_custo: "Sem custo cadastrado",
  taxas_pendentes: "Taxas ainda não liberadas",
} as const;
export type Problema = keyof typeof PROBLEMAS;

export interface FiltrosDePedido {
  period: DateRangePreset;
  q: string;
  status: OrderStatus | "";
  marketplace: MarketplaceType | "";
  problema: Problema | "";
}

type Params = Record<string, string | string[] | undefined>;

function um(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Valor fora da lista vira o padrão: a URL é editável, o enum do banco não. */
export function lerFiltros(sp: Params): FiltrosDePedido {
  const period = um(sp.period) as DateRangePreset;
  const status = um(sp.status) as OrderStatus;
  const marketplace = um(sp.marketplace) as MarketplaceType;
  const problema = um(sp.problema) as Problema;
  return {
    period: PERIODOS.includes(period) ? period : "last_30_days",
    q: um(sp.q).trim().slice(0, 100),
    status: STATUS.includes(status) ? status : "",
    marketplace: MARKETPLACES.includes(marketplace) ? marketplace : "",
    problema: problema in PROBLEMAS ? problema : "",
  };
}

export function temFiltroAlemDoPeriodo(f: FiltrosDePedido): boolean {
  return Boolean(f.q || f.status || f.marketplace || f.problema);
}

/**
 * `where` do Prisma para os filtros.
 *
 * "Com prejuízo" não tem como ser uma condição de banco sem copiar a conta do
 * motor financeiro para SQL — e duas versões da conta é o que o §60 proíbe.
 * Aqui ele só restringe aos pedidos que contam como venda; quem chama calcula
 * o lucro com `calcularPedido` e descarta o resto.
 */
export function whereDosFiltros(workspaceId: string, timezone: string, f: FiltrosDePedido): Prisma.OrderWhereInput {
  const range = resolveDateRange(f.period, timezone);
  const and: Prisma.OrderWhereInput[] = [];

  if (f.q) {
    and.push({
      OR: [
        { externalOrderId: { contains: f.q, mode: "insensitive" } },
        {
          items: {
            some: {
              OR: [
                { externalSku: { contains: f.q, mode: "insensitive" } },
                { title: { contains: f.q, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }
  if (f.problema === "sem_custo") and.push({ items: { some: unknownCostWhere() } });
  if (f.problema === "taxas_pendentes") and.push({ feesAreEstimated: true });
  if (f.problema === "prejuizo") and.push({ status: { notIn: [...revenueOrdersWhere.status.notIn] } });

  return {
    workspaceId,
    orderedAt: { gte: range.from, lte: range.to },
    ...(f.status ? { status: f.status } : {}),
    ...(f.marketplace ? { marketplace: f.marketplace } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/** Query string dos filtros, sem os valores padrão — para links e paginação. */
export function queryDosFiltros(f: FiltrosDePedido, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (f.period !== "last_30_days") p.set("period", f.period);
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.marketplace) p.set("marketplace", f.marketplace);
  if (f.problema) p.set("problema", f.problema);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Só o que a lista e a exportação usam — sem `rawPayload`, que pode ser grande. */
export const SELECAO_DE_PEDIDO = {
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
  items: {
    select: {
      quantity: true,
      unitPrice: true,
      unitCostSnapshot: true,
      packagingCostSnapshot: true,
      operationalCostSnapshot: true,
      otherCostsSnapshot: true,
      taxPercentSnapshot: true,
      externalSku: true,
      title: true,
    },
  },
  refunds: { select: { amount: true } },
} satisfies Prisma.OrderSelect;

/**
 * Acima disto, "com prejuízo" pede um período menor em vez de carregar tudo
 * na memória de uma função serverless.
 */
export const LIMITE_PARA_FILTRO_DE_PREJUIZO = 5000;
