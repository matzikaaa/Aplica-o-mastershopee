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
}

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
  { key: "orderedAt", label: "Data do pedido", required: true, aliases: ["data", "data do pedido", "data de criacao", "criado em", "order date"] },
  { key: "sku", label: "SKU do item", required: true, aliases: ["sku", "sku de referencia", "codigo do produto", "sku do produto"] },
  { key: "quantity", label: "Quantidade", required: true, aliases: ["quantidade", "qtd", "quantity", "qtde"] },
  { key: "grossAmount", label: "Valor da venda", required: true, hint: "Total pago pelo cliente por este item", aliases: ["valor", "total", "subtotal", "preco", "valor total", "receita"] },
  { key: "commissionAmount", label: "Comissão", required: false, aliases: ["comissao", "taxa de comissao", "commission"] },
  { key: "marketplaceFeeAmount", label: "Taxa fixa / serviço", required: false, aliases: ["taxa", "taxa de servico", "tarifa", "taxa fixa"] },
  { key: "shippingSubsidizedByMerchant", label: "Frete pago por você", required: false, aliases: ["frete", "frete vendedor", "subsidio de frete", "custo de frete"] },
  { key: "taxAmount", label: "Imposto", required: false, aliases: ["imposto", "tributo", "icms"] },
  { key: "status", label: "Status", required: false, hint: "Cancelado/devolvido não conta como venda", aliases: ["status", "situacao", "order status"] },
];

export const ADS_IMPORT_FIELDS: ImportField[] = [
  { key: "date", label: "Data", required: true, aliases: ["data", "dia", "date", "data do relatorio"] },
  { key: "campaignName", label: "Campanha", required: true, aliases: ["campanha", "nome da campanha", "campaign", "anuncio"] },
  { key: "spend", label: "Gasto", required: true, aliases: ["gasto", "investimento", "custo", "despesa", "valor gasto", "spend"] },
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
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const taken = new Set<string>();
  const mapping: Record<string, string | null> = {};

  for (const field of fields) {
    const exact = normalized.find((h) => !taken.has(h.raw) && field.aliases.includes(h.norm));
    if (exact) {
      mapping[field.key] = exact.raw;
      taken.add(exact.raw);
      continue;
    }
    const partial = normalized.find(
      (h) =>
        !taken.has(h.raw) &&
        field.aliases.some((a) => h.norm.includes(a) || (a.length > 4 && a.includes(h.norm))),
    );
    if (partial) {
      mapping[field.key] = partial.raw;
      taken.add(partial.raw);
      continue;
    }
    mapping[field.key] = null;
  }

  return mapping;
}

/**
 * Reads a number written the Brazilian way, and also plain machine format.
 *
 * A comma always means the decimal separator. Without one, a dot followed by
 * exactly three digits is read as a thousands separator ("1.234" = 1234),
 * which is how exports write whole currency values; any other dot is a
 * decimal point ("12.34" = 12.34).
 *
 * Returns null — never 0 — for blanks and anything unparseable.
 */
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

/** Accepts dd/mm/yyyy and yyyy-mm-dd, with or without a time part. */
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

/** Maps marketplace status wording onto our OrderStatus values. */
export function normalizeOrderStatus(raw: unknown): string {
  const s = normalizeHeader(String(raw ?? ""));
  if (!s) return "PAID";
  if (/cancel/.test(s)) return "CANCELED";
  if (/devolv|retorn|return/.test(s)) return "RETURNED";
  if (/reembols|estorn|refund/.test(s)) return "REFUNDED";
  if (/entreg|conclu|complet|deliver/.test(s)) return "DELIVERED";
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
}
