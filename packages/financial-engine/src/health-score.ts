import Decimal from "decimal.js";

export interface OperationHealthInput {
  netMarginPercent: Decimal.Value;
  roas: Decimal.Value | null;
  negativeMarginProductShare: Decimal.Value; // 0-100, % of SKUs sold at a loss
  returnRatePercent: Decimal.Value;
  revenueGrowthPercent: Decimal.Value | null; // vs previous period
  connectedIntegrationsHealthy: number; // 0-1 ratio
}

export interface OperationHealthResult {
  score: number; // 0-100
  label: "Crítico" | "Atenção" | "Bom" | "Excelente";
  components: Record<string, number>;
  methodology: string;
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

/**
 * Internal composite score (§49) — explicitly *not* a marketplace metric,
 * just a weighted heuristic to give the seller a single "how's my
 * operation doing" number. Methodology is always exposed alongside the
 * score so it never reads as an authoritative external rating.
 */
export function calculateOperationHealth(input: OperationHealthInput): OperationHealthResult {
  const margin = new Decimal(input.netMarginPercent).toNumber();
  const marginScore = clamp(margin <= 0 ? 0 : (margin / 25) * 100); // 25%+ net margin = full marks

  const roasScore =
    input.roas === null ? 70 : clamp((new Decimal(input.roas).toNumber() / 6) * 100); // ROAS 6x = full marks

  const negativeShare = new Decimal(input.negativeMarginProductShare).toNumber();
  const lossProductsScore = clamp(100 - negativeShare * 4);

  const returnRate = new Decimal(input.returnRatePercent).toNumber();
  const returnsScore = clamp(100 - returnRate * 5);

  const growth = input.revenueGrowthPercent === null ? 60 : new Decimal(input.revenueGrowthPercent).toNumber();
  const growthScore = clamp(50 + growth); // flat growth = 50, +50% growth = full marks

  const integrationsScore = clamp(input.connectedIntegrationsHealthy * 100);

  const weights = {
    margin: 0.3,
    roas: 0.15,
    lossProducts: 0.2,
    returns: 0.1,
    growth: 0.15,
    integrations: 0.1,
  };

  const components = {
    margin: Math.round(marginScore),
    roas: Math.round(roasScore),
    lossProducts: Math.round(lossProductsScore),
    returns: Math.round(returnsScore),
    growth: Math.round(growthScore),
    integrations: Math.round(integrationsScore),
  };

  const score = Math.round(
    marginScore * weights.margin +
      roasScore * weights.roas +
      lossProductsScore * weights.lossProducts +
      returnsScore * weights.returns +
      growthScore * weights.growth +
      integrationsScore * weights.integrations,
  );

  const label = score >= 85 ? "Excelente" : score >= 65 ? "Bom" : score >= 40 ? "Atenção" : "Crítico";

  return {
    score,
    label,
    components,
    methodology:
      "Índice interno da Mastershopee: 30% margem líquida, 20% produtos com prejuízo, 15% ROAS, " +
      "15% crescimento de receita, 10% devoluções, 10% saúde das integrações conectadas.",
  };
}
