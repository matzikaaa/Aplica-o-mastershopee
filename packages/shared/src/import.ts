/**
 * Spreadsheet import helpers.
 *
 * Marketplace exports use their own column names, so nothing here assumes a
 * fixed layout: the operator maps their columns onto our fields, and these
 * helpers only guess a sensible starting mapping and parse the values.
 *
 * Parsing is deliberately strict about returning `null` for anything it
 * cannot read. A silently-coerced 0 in a cost column is a wrong profit
 * number that looks right, which is exactly what this project refuses to
 * produce (§96) — the importer reports the row as an error instead.
 */

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  /** Header names seen in real exports, lowercased and accent-free. */
  aliases: string[];
  /**
   * Only accept an exact alias match. For columns where a near-miss books the
   * wrong number — an ad report's campaign start date standing in for the day
   * the money was spent — no guess is better than a plausible wrong one.
   */
  strict?: boolean;
}

export interface DiscoveredSku {
  sku: string;
  /** Null when no report column carried a name — the caller decides the fallback. */
  name: string | null;
  /** Spreadsheet line where this SKU first appeared, for error reporting. */
  row: number;
}

/**
 * Collapse a marketplace report down to its distinct SKUs.
 *
 * A sales report has one line per sale, so the same SKU appears dozens of
 * times, sometimes with the name filled in on only some of the lines. The
 * first occurrence sets the position; the first non-empty name wins.
 */
export function collectDiscoveredSkus(rows: { sku?: string; name?: string }[]): {
  skus: DiscoveredSku[];
  blankRows: number[];
} {
  const bySku = new Map<string, DiscoveredSku>();
  const blankRows: number[] = [];

  rows.forEach((row, index) => {
    const line = index + 2; // +1 header row, +1 for 1-based counting
    const sku = row.sku?.trim();
    const name = row.name?.trim() || null;

    if (!sku) {
      blankRows.push(line);
      return;
    }

    const existing = bySku.get(sku);
    if (!existing) {
      bySku.set(sku, { sku, name, row: line });
    } else if (!existing.name && name) {
      existing.name = name;
    }
  });

  return { skus: [...bySku.values()], blankRows };
}

export const SKU_DISCOVERY_FIELDS: ImportField[] = [
  // "numero de referencia sku" is the variation-level SKU in Shopee's order
  // export and is the one actually filled in; the parent column ("n de
  // referencia do sku principal") is blank on most rows, so it must never win
  // the guess.
  { key: "sku", label: "SKU", required: true, hint: "A mesma coluna de SKU que aparece no relatório de pedidos", aliases: ["sku", "sku do produto", "sku de referencia", "numero de referencia sku", "codigo", "cod", "referencia", "codigo do produto"] },
  { key: "name", label: "Nome do produto", required: false, hint: "Se o relatório não tiver, o SKU vira o nome provisório", aliases: ["nome", "produto", "descricao", "titulo", "nome do produto", "nome do anuncio"] },
];

export const PRODUCT_IMPORT_FIELDS: ImportField[] = [
  { key: "sku", label: "SKU", required: true, aliases: ["sku", "codigo", "cod", "referencia", "sku do produto"] },
  { key: "name", label: "Nome do produto", required: true, aliases: ["nome", "produto", "descricao", "titulo", "nome do produto"] },
  { key: "unitCost", label: "Custo unitário", required: false, hint: "Quanto você paga por unidade", aliases: ["custo", "custo unitario", "preco de custo", "valor de custo"] },
  { key: "packagingCost", label: "Custo de embalagem", required: false, aliases: ["embalagem", "custo embalagem", "custo de embalagem"] },
  { key: "quantity", label: "Estoque atual", required: false, aliases: ["estoque", "quantidade", "saldo", "qtd", "estoque atual"] },
  { key: "supplierName", label: "Fornecedor", required: false, aliases: ["fornecedor", "supplier"] },
  { key: "leadTimeDays", label: "Prazo de entrega (dias)", required: false, aliases: ["prazo", "lead time", "prazo entrega", "prazo de entrega"] },
];

export const ORDER_IMPORT_FIELDS: ImportField[] = [
  { key: "externalOrderId", label: "Nº do pedido", required: true, hint: "Identificador do pedido no marketplace", aliases: ["id do pedido", "numero do pedido", "pedido", "order id", "order sn", "n do pedido", "codigo do pedido"] },
  // Exact alias for Shopee's creation date: several other date columns
  // ("Data prevista de envio") appear earlier in the file and would win a
  // partial match on "data".
  { key: "orderedAt", label: "Data do pedido", required: true, aliases: ["data", "data do pedido", "data de criacao", "data de criacao do pedido", "criado em", "order date"] },
  { key: "sku", label: "SKU do item", required: true, aliases: ["sku", "sku de referencia", "numero de referencia sku", "codigo do produto", "sku do produto"] },
  { key: "quantity", label: "Quantidade", required: true, aliases: ["quantidade", "qtd", "quantity", "qtde"] },
  // The item's own subtotal, not the order total: "Valor Total" in Shopee's
  // export includes shipping paid by the buyer, which is not seller revenue.
  { key: "grossAmount", label: "Valor da venda", required: true, hint: "Total pago pelo cliente por este item", aliases: ["subtotal do produto", "subtotal", "valor total", "total", "receita"] },
  { key: "commissionAmount", label: "Comissão", required: false, aliases: ["comissao", "taxa de comissao", "taxa de comissao bruta", "commission"] },
  { key: "marketplaceFeeAmount", label: "Taxa fixa / serviço", required: false, aliases: ["taxa de servico", "taxa de servico bruta", "tarifa", "taxa fixa"] },
  // No bare "frete" alias on purpose: Shopee's order export carries several
  // shipping columns, all of them money the *buyer* paid or Shopee subsidised.
  // Guessing one of those here would book someone else's cost as yours.
  { key: "shippingSubsidizedByMerchant", label: "Frete pago por você", required: false, hint: "Só o frete que sai do seu bolso — deixe em branco se o relatório não separar isso", aliases: ["frete vendedor", "frete pago pelo vendedor", "subsidio de frete", "custo de frete"] },
  { key: "taxAmount", label: "Imposto", required: false, aliases: ["imposto", "tributo", "icms"] },
  { key: "status", label: "Status", required: false, hint: "Cancelado/devolvido não conta como venda", aliases: ["status", "status do pedido", "situacao", "order status"] },
];

export const ADS_IMPORT_FIELDS: ImportField[] = [
  // Strict: the Shopee "Dados Gerais de Anúncios" export is a period total and
  // carries "Data de Início" (when the campaign started), which is not the day
  // the money was spent. Spreading a period total across days would be an
  // invented number, so the field stays unmapped and the import is blocked.
  { key: "date", label: "Data", required: true, strict: true, hint: "Precisa ser um relatório com uma linha por campanha por dia", aliases: ["data", "dia", "date", "data do relatorio", "data do gasto"] },
  { key: "campaignName", label: "Campanha", required: true, aliases: ["campanha", "nome da campanha", "nome do anuncio", "campaign", "anuncio"] },
  { key: "spend", label: "Gasto", required: true, aliases: ["gasto", "despesas", "investimento", "custo", "despesa", "valor gasto", "spend"] },
  { key: "attributedRevenue", label: "Receita atribuída", required: false, aliases: ["receita", "gmv", "vendas", "receita atribuida", "faturamento"] },
  { key: "orders", label: "Pedidos", required: false, aliases: ["pedidos", "conversoes", "vendas (pedidos)", "orders"] },
  { key: "clicks", label: "Cliques", required: false, aliases: ["cliques", "clicks"] },
  { key: "impressions", label: "Impressões", required: false, aliases: ["impressoes", "visualizacoes", "impressions"] },
];

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort initial mapping. Exact alias matches win; otherwise a header
 * that contains an alias (or vice-versa) is offered. Every guess stays
 * editable — this only saves clicks, it never decides.
 */
export function guessMapping(headers: string[], fields: ImportField[]): Record<string, string | null> {
  // A header like "#" normalizes to an empty string, which would otherwise
  // be a substring of every alias and match the first field that asks.
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) })).filter((h) => h.norm !== "");
  const taken = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const field of fields) mapping[field.key] = null;

  // Two passes on purpose: every exact match is claimed before any fuzzy one.
  // Otherwise an early field's loose guess ("taxa" matching "Taxa de envio
  // pagas pelo comprador") steals the column a later field names exactly.
  for (const field of fields) {
    const exact = normalized.find((h) => !taken.has(h.raw) && field.aliases.includes(h.norm));
    if (exact) {
      mapping[field.key] = exact.raw;
      taken.add(exact.raw);
    }
  }

  for (const field of fields) {
    if (mapping[field.key] || field.strict) continue;
    const partial = normalized.find(
      (h) =>
        !taken.has(h.raw) &&
        field.aliases.some((a) => h.norm.includes(a) || (a.length > 4 && a.includes(h.norm))),
    );
    if (partial) {
      mapping[field.key] = partial.raw;
      taken.add(partial.raw);
    }
  }

  return mapping;
}

/**
 * Find the real header row in an export that opens with a preamble.
 *
 * Shopee's ad report starts with seven lines of store metadata and a blank
 * line before the actual header, so reading row 1 as the header yields a
 * one-column sheet named "Relatório de Todos os Anúncios CPC". The widest row
 * near the top is the header; ties go to the earliest, and a file with no
 * preamble is unaffected because row 0 already wins.
 */
export function detectHeaderRow(rows: unknown[][], lookahead = 20): number {
  let best = 0;
  let bestWidth = 0;

  for (let i = 0; i < Math.min(rows.length, lookahead); i++) {
    const width = (rows[i] ?? []).filter((c) => String(c ?? "").trim() !== "").length;
    // Strictly greater: the earliest of equally wide rows stays the header.
    if (width > bestWidth) {
      best = i;
      bestWidth = width;
    }
  }

  // A single-column "header" is a title line, not a header — but if that is
  // genuinely the widest row the file has, there is nothing better to pick.
  return bestWidth >= 2 ? best : 0;
}

export function parseBrNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;

  let s = String(raw).trim();
  if (s === "") return null;

  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "");
  s = s.replace(/r\$/i, "").replace(/\s/g, "").replace(/%/g, "");
  if (s === "") return null;

  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }

  if (!/^\d*\.?\d+$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
export function parseBrDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (raw === null || raw === undefined) return null;

  const s = String(raw).trim();
  if (s === "") return null;

  const br = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = br;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, m, d, hh = "0", mm = "0", ss = "0"] = iso;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function normalizeOrderStatus(raw: unknown): string {
  const s = normalizeHeader(String(raw ?? ""));
  if (!s) return "PAID";
  if (/cancel/.test(s)) return "CANCELED";
  // Shopee stamps delivered orders with "O comprador pode pedir uma devolução
  // até <data>" — the buyer *may* still open one, none was opened. Reading
  // that as a return would erase a real sale, so it is matched before the
  // return rule and settled as delivered.
  if (/pode (pedir|solicitar).*(devolu|reembols)|prazo (de|para) devolu/.test(s)) return "DELIVERED";
  // "devolu" as well as "devolv": accent stripping turns "devolução" into
  // "devolucao", which the old pattern never matched.
  if (/devolv|devolu|retorn|return/.test(s)) return "RETURNED";
  if (/reembols|estorn|refund/.test(s)) return "REFUNDED";
  if (/entreg|conclu|complet|deliver/.test(s)) return "DELIVERED";
  // "A enviar" / "Envio pendente" is Shopee's *awaiting* shipment state — the
  // order is paid but nothing has left yet. It must be checked before the
  // shipped rule below, which would otherwise match on "envi".
  if (/a enviar|aguardando envio|envio pendente|preparando|to ship/.test(s)) return "PAID";
  if (/nao pago|aguardando pagamento|unpaid|pendente de pagamento/.test(s)) return "CREATED";
  if (/envi|transit|ship|postad/.test(s)) return "SHIPPED";
  if (/pag|paid|aprovad/.test(s)) return "PAID";
  return "PAID";
}

export interface ImportRowError {
  row: number;
  message: string;
  reference?: string;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  /** Optional closing note from the importer: what the operator should do next. */
  note?: string;
}
