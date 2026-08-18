import type { MarketplaceType } from "@mastershopee/shared";
import { PLAN_CATALOG, isUnlimited, type PlanCode } from "./plans";
import {
  hasDashboardAccess,
  hasFullAccess,
  type SubscriptionStatus,
} from "./subscription-state";

export interface WorkspaceBillingContext {
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatus;
  marketplaceAccountCountsByType: Partial<Record<MarketplaceType, number>>;
  teamMemberCount: number;
  ordersThisMonth: number;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  upgradeTo?: PlanCode;
}

function allow(): PermissionResult {
  return { allowed: true };
}

function deny(reason: string, upgradeTo?: PlanCode): PermissionResult {
  return { allowed: false, reason, upgradeTo };
}

/**
 * The single place in the codebase that answers "is this workspace allowed
 * to do X". Every route/UI that needs a plan check calls into this instead
 * of comparing `plan.code === "PRO"` inline (§28) — that keeps limits and
 * feature flags centralized and consistent between frontend gating and
 * backend enforcement.
 */
export class PlanPermissionService {
  constructor(private readonly ctx: WorkspaceBillingContext) {}

  private get plan() {
    return PLAN_CATALOG[this.ctx.planCode];
  }

  hasDashboardAccess(): boolean {
    return hasDashboardAccess(this.ctx.subscriptionStatus);
  }

  hasFullAccess(): boolean {
    return hasFullAccess(this.ctx.subscriptionStatus);
  }

  getMarketplaceLimit(): number {
    return this.plan.limits.marketplaceAccountsPerType;
  }

  canConnectMarketplace(type: MarketplaceType): PermissionResult {
    if (!this.hasFullAccess()) {
      return deny("Sua assinatura precisa estar ativa para conectar novas contas.");
    }
    const limit = this.getMarketplaceLimit();
    const current = this.ctx.marketplaceAccountCountsByType[type] ?? 0;
    if (isUnlimited(limit) || current < limit) return allow();

    const nextPlan = this.ctx.planCode === "STARTER" ? "PRO" : "SCALE";
    return deny(
      `Você atingiu o limite do seu plano. Seu plano atual permite ${limit} conta(s) por marketplace. ` +
        "Faça upgrade para conectar novas operações.",
      nextPlan,
    );
  }

  /** Alias kept for readability at call sites that add a *new* account vs. reconnecting an existing one. */
  canAddMarketplaceAccount(type: MarketplaceType): PermissionResult {
    return this.canConnectMarketplace(type);
  }

  canUseWhatsApp(): PermissionResult {
    if (!this.plan.features.whatsapp) {
      return deny("O envio de relatórios por WhatsApp está disponível a partir do plano Pro.", "PRO");
    }
    return allow();
  }

  canUseAds(): PermissionResult {
    if (!this.plan.features.ads) {
      return deny("O painel de Publicidade está disponível a partir do plano Pro.", "PRO");
    }
    return allow();
  }

  canUseAdvancedReports(): PermissionResult {
    if (!this.plan.features.advancedReports) {
      return deny("Relatórios avançados estão disponíveis a partir do plano Pro.", "PRO");
    }
    return allow();
  }

  canUseAdvancedAlerts(): PermissionResult {
    if (this.plan.features.alerts !== "advanced") {
      return deny("Alertas configuráveis estão disponíveis a partir do plano Pro.", "PRO");
    }
    return allow();
  }

  canAddTeamMember(): PermissionResult {
    const limit = this.plan.limits.teamMembers;
    if (isUnlimited(limit) || this.ctx.teamMemberCount < limit) return allow();
    return deny(
      `Seu plano permite até ${limit} usuário(s). Faça upgrade para convidar mais pessoas.`,
      this.ctx.planCode === "STARTER" ? "PRO" : "SCALE",
    );
  }

  canProcessMoreOrders(): PermissionResult {
    const limit = this.plan.limits.ordersPerMonth;
    if (isUnlimited(limit) || this.ctx.ordersThisMonth < limit) return allow();
    return deny(
      `Seu plano processa até ${limit} pedidos/mês. Faça upgrade para continuar sincronizando sem interrupções.`,
      this.ctx.planCode === "STARTER" ? "PRO" : "SCALE",
    );
  }

  getReportHistoryMonths(): number {
    return this.plan.limits.reportHistoryMonths;
  }
}
