import { describe, expect, it } from "vitest";
import { PlanPermissionService, type WorkspaceBillingContext } from "../permissions";

function ctx(overrides: Partial<WorkspaceBillingContext> = {}): WorkspaceBillingContext {
  return {
    planCode: "STARTER",
    subscriptionStatus: "active",
    marketplaceAccountCountsByType: {},
    teamMemberCount: 1,
    ordersThisMonth: 0,
    ...overrides,
  };
}

describe("PlanPermissionService — marketplace account limits (§29)", () => {
  it("allows connecting the first Shopee account on Starter", () => {
    const service = new PlanPermissionService(ctx({ marketplaceAccountCountsByType: { SHOPEE: 0 } }));
    expect(service.canConnectMarketplace("SHOPEE").allowed).toBe(true);
  });

  it("blocks a second Shopee account on Starter (limit is 1 per marketplace) and suggests Pro", () => {
    const service = new PlanPermissionService(ctx({ marketplaceAccountCountsByType: { SHOPEE: 1 } }));
    const result = service.canConnectMarketplace("SHOPEE");
    expect(result.allowed).toBe(false);
    expect(result.upgradeTo).toBe("PRO");
    expect(result.reason).toMatch(/limite do seu plano/i);
  });

  it("does not let a Shopee-account count block a Mercado Livre connection (limits are per marketplace type)", () => {
    const service = new PlanPermissionService(
      ctx({ marketplaceAccountCountsByType: { SHOPEE: 1, MERCADO_LIVRE: 0 } }),
    );
    expect(service.canConnectMarketplace("MERCADO_LIVRE").allowed).toBe(true);
  });

  it("Pro plan allows up to 3 accounts of the same marketplace", () => {
    const service = new PlanPermissionService(
      ctx({ planCode: "PRO", marketplaceAccountCountsByType: { SHOPEE: 2 } }),
    );
    expect(service.canConnectMarketplace("SHOPEE").allowed).toBe(true);
    const atLimit = new PlanPermissionService(
      ctx({ planCode: "PRO", marketplaceAccountCountsByType: { SHOPEE: 3 } }),
    );
    expect(atLimit.canConnectMarketplace("SHOPEE").allowed).toBe(false);
  });

  it("Scale plan treats -1 as unlimited orders/month", () => {
    const service = new PlanPermissionService(
      ctx({ planCode: "SCALE", ordersThisMonth: 1_000_000 }),
    );
    expect(service.canProcessMoreOrders().allowed).toBe(true);
  });
});

describe("PlanPermissionService — feature gating", () => {
  it("blocks WhatsApp on Starter", () => {
    const service = new PlanPermissionService(ctx({ planCode: "STARTER" }));
    expect(service.canUseWhatsApp().allowed).toBe(false);
  });

  it("allows WhatsApp on Pro and Scale", () => {
    expect(new PlanPermissionService(ctx({ planCode: "PRO" })).canUseWhatsApp().allowed).toBe(true);
    expect(new PlanPermissionService(ctx({ planCode: "SCALE" })).canUseWhatsApp().allowed).toBe(true);
  });

  it("blocks Ads dashboard and advanced reports on Starter", () => {
    const service = new PlanPermissionService(ctx({ planCode: "STARTER" }));
    expect(service.canUseAds().allowed).toBe(false);
    expect(service.canUseAdvancedReports().allowed).toBe(false);
  });
});

describe("PlanPermissionService — subscription state machine (§31)", () => {
  it("blocks all access when subscription is canceled", () => {
    const service = new PlanPermissionService(ctx({ subscriptionStatus: "canceled" }));
    expect(service.hasDashboardAccess()).toBe(false);
  });

  it("grants full access while trialing", () => {
    const service = new PlanPermissionService(ctx({ subscriptionStatus: "trialing" }));
    expect(service.hasDashboardAccess()).toBe(true);
    expect(service.hasFullAccess()).toBe(true);
  });

  it("past_due keeps dashboard visible (grace period) but is not full access", () => {
    const service = new PlanPermissionService(ctx({ subscriptionStatus: "past_due" }));
    expect(service.hasDashboardAccess()).toBe(true);
    expect(service.hasFullAccess()).toBe(false);
  });

  it("past_due blocks connecting new marketplace accounts even if under the plan limit", () => {
    const service = new PlanPermissionService(
      ctx({ subscriptionStatus: "past_due", marketplaceAccountCountsByType: { SHOPEE: 0 } }),
    );
    expect(service.canConnectMarketplace("SHOPEE").allowed).toBe(false);
  });

  it("expired and incomplete subscriptions are also blocked", () => {
    expect(new PlanPermissionService(ctx({ subscriptionStatus: "expired" })).hasDashboardAccess()).toBe(false);
    expect(new PlanPermissionService(ctx({ subscriptionStatus: "incomplete" })).hasDashboardAccess()).toBe(false);
  });
});

describe("PlanPermissionService — team members", () => {
  it("blocks inviting a 2nd member on Starter (limit 1)", () => {
    const service = new PlanPermissionService(ctx({ planCode: "STARTER", teamMemberCount: 1 }));
    expect(service.canAddTeamMember().allowed).toBe(false);
  });

  it("allows inviting up to 5 members on Pro", () => {
    const service = new PlanPermissionService(ctx({ planCode: "PRO", teamMemberCount: 4 }));
    expect(service.canAddTeamMember().allowed).toBe(true);
  });
});
