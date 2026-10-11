export type MarketplaceType = "SHOPEE" | "MERCADO_LIVRE" | "SHEIN" | "TIKTOK_SHOP";

/**
 * Nome do status do pedido como o vendedor o lê.
 *
 * Morava dentro da página de lista, e por isso a página de detalhe mostrava o
 * enum cru — "Entregue" numa tela, "DELIVERED" na seguinte, para o mesmo
 * pedido. Rótulo que aparece em mais de uma tela mora aqui.
 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  CREATED: "Criado",
  PAID: "Pago",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  CANCELED: "Cancelado",
  REFUNDED: "Reembolsado",
  RETURNED: "Devolvido",
};

/** Papel de cada pessoa no workspace, como aparece em Configurações → Usuários. */
export const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  OWNER: "Dono",
  ADMIN: "Administrador",
  MEMBER: "Membro",
  VIEWER: "Somente leitura",
};

/** Nome do marketplace para a tela; o enum cru nunca deve aparecer para o vendedor. */
export function nomeDoMarketplace(m: string): string {
  return (MARKETPLACE_LABELS as Record<string, string>)[m] ?? m;
}

export const MARKETPLACE_LABELS: Record<MarketplaceType, string> = {
  SHOPEE: "Shopee",
  MERCADO_LIVRE: "Mercado Livre",
  SHEIN: "SHEIN",
  TIKTOK_SHOP: "TikTok Shop",
};

export type DataQualityStatus = "complete" | "partial" | "processing" | "stale" | "error";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "all_time"
  | "custom";

export interface DateRange {
  from: Date;
  to: Date;
}

/** Line-by-line breakdown behind every profit figure shown to the user (§21, §83). */
export interface ProfitBreakdown {
  grossRevenue: string;
  discounts: string;
  commission: string;
  marketplaceFees: string;
  shipping: string;
  adSpend: string;
  productCost: string;
  packaging: string;
  taxes: string;
  refunds: string;
  otherCosts: string;
  netProfit: string;
  marginPercent: string;
}

export type ProductHealthStatus = "profitable" | "low_margin" | "loss";

export function classifyProductHealth(marginPercent: number): ProductHealthStatus {
  if (marginPercent < 0) return "loss";
  if (marginPercent < 10) return "low_margin";
  return "profitable";
}
