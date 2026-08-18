export type PlanCode = "STARTER" | "PRO" | "SCALE";

export interface PlanLimits {
  /** Max connected accounts per marketplace type (Shopee, ML, SHEIN, TikTok Shop each counted separately). -1 = unlimited. */
  marketplaceAccountsPerType: number;
  ordersPerMonth: number; // -1 = unlimited
  teamMembers: number;
  reportHistoryMonths: number;
}

export interface PlanFeatures {
  whatsapp: boolean;
  ads: boolean;
  advancedReports: boolean;
  alerts: "basic" | "advanced";
  prioritySupport?: boolean;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

/**
 * Single source of truth for what each plan includes (§28-29). Mirrors the
 * `Plan.limits` / `Plan.features` JSON columns seeded in the database —
 * this in-code catalog is what the app reads from at runtime via
 * PlanPermissionService so a plan check is never duplicated or drifted
 * across UI and API.
 */
export const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
  STARTER: {
    code: "STARTER",
    name: "Starter",
    description: "Para vendedores iniciantes em marketplaces.",
    priceMonthly: 97,
    priceYearly: 970,
    limits: {
      marketplaceAccountsPerType: 1,
      ordersPerMonth: 1500,
      teamMembers: 1,
      reportHistoryMonths: 3,
    },
    features: {
      whatsapp: false,
      ads: false,
      advancedReports: false,
      alerts: "basic",
    },
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    description: "Para operações em crescimento com múltiplas contas.",
    priceMonthly: 247,
    priceYearly: 2470,
    limits: {
      marketplaceAccountsPerType: 3,
      ordersPerMonth: 15000,
      teamMembers: 5,
      reportHistoryMonths: 12,
    },
    features: {
      whatsapp: true,
      ads: true,
      advancedReports: true,
      alerts: "advanced",
    },
  },
  SCALE: {
    code: "SCALE",
    name: "Scale",
    description: "Para operações de alto volume e múltiplos usuários.",
    priceMonthly: 597,
    priceYearly: 5970,
    limits: {
      marketplaceAccountsPerType: 10,
      ordersPerMonth: -1,
      teamMembers: 20,
      reportHistoryMonths: 36,
    },
    features: {
      whatsapp: true,
      ads: true,
      advancedReports: true,
      alerts: "advanced",
      prioritySupport: true,
    },
  },
};

export const PLAN_ORDER: PlanCode[] = ["STARTER", "PRO", "SCALE"];

export function isUnlimited(limit: number): boolean {
  return limit === -1;
}
