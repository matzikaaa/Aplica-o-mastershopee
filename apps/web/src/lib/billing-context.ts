import { prisma } from "@mastershopee/database";
import { PlanPermissionService, type WorkspaceBillingContext, type PlanCode } from "@mastershopee/billing";
import type { MarketplaceType } from "@mastershopee/shared";

/**
 * Builds the billing context PlanPermissionService needs from live
 * database state. This is the only place that translates DB rows into
 * the service's input — everywhere else in the app calls the service,
 * never re-derives plan checks by hand (§28).
 */
export async function getPlanPermissionService(workspaceId: string): Promise<PlanPermissionService> {
  const [subscription, accounts, memberCount, ordersThisMonth] = await Promise.all([
    prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
    prisma.marketplaceAccount.groupBy({
      by: ["marketplace"],
      where: { workspaceId, status: { not: "DISCONNECTED" } },
      _count: true,
    }),
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.order.count({
      where: { workspaceId, orderedAt: { gte: new Date(new Date().setDate(1)) } },
    }),
  ]);

  const marketplaceAccountCountsByType = Object.fromEntries(
    accounts.map((a) => [a.marketplace, a._count]),
  ) as Partial<Record<MarketplaceType, number>>;

  const ctx: WorkspaceBillingContext = {
    planCode: (subscription?.plan.code as PlanCode) ?? "STARTER",
    subscriptionStatus: subscription?.status ?? "incomplete",
    marketplaceAccountCountsByType,
    teamMemberCount: memberCount,
    ordersThisMonth,
  };

  return new PlanPermissionService(ctx);
}
