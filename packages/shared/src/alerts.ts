import { formatBRL } from "./daily-report";

/** Nome de cada tipo de regra, o mesmo no formulário e na lista. */
export const ALERT_RULE_LABELS: Record<string, string> = {
  NEGATIVE_MARGIN_PRODUCT: "Produto com margem negativa",
  AD_SPEND_THRESHOLD: "Gasto com ADS acima de um valor",
  NET_MARGIN_BELOW: "Margem líquida abaixo de um percentual",
  MARKETPLACE_SYNC_FAILED: "Marketplace parou de sincronizar",
  DAILY_REVENUE_ABOVE: "Faturamento diário acima de um valor",
};

/**
 * A regra como o vendedor a configurou, com o limite: "Gasto com ADS acima de
 * R$ 500,00 no dia" diz o que vai acontecer; "AD_SPEND_THRESHOLD" não.
 */
export function descreverRegraDeAlerta(type: string, config: unknown): string {
  const c = (config ?? {}) as Record<string, unknown>;
  const limite = Number(c.threshold ?? c.minMarginPercent ?? c.thresholdAmount);
  const temLimite = Number.isFinite(limite);
  switch (type) {
    case "AD_SPEND_THRESHOLD":
      if (temLimite) return `Gasto com ADS acima de ${formatBRL(limite)} no dia`;
      break;
    case "NET_MARGIN_BELOW":
      if (temLimite) {
        const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(limite);
        return `Margem líquida do dia abaixo de ${pct}%`;
      }
      break;
    case "DAILY_REVENUE_ABOVE":
      if (temLimite) return `Faturamento do dia acima de ${formatBRL(limite)}`;
      break;
  }
  return ALERT_RULE_LABELS[type] ?? type;
}
