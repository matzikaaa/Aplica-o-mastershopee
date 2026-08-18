/**
 * Storage-agnostic usage tracking (§88). apps/web/apps/worker implement
 * `UsageCounterStore` against `packages/database` (the `UsageCounter`
 * table); keeping the interface here lets PlanPermissionService and its
 * tests stay free of a Prisma dependency.
 */
export interface UsageCounterStore {
  increment(workspaceId: string, metric: string, periodStart: Date, periodEnd: Date, by?: number): Promise<number>;
  get(workspaceId: string, metric: string, periodStart: Date): Promise<number>;
}

export type UsageMetric =
  | "marketplaceAccountsUsed"
  | "ordersProcessed"
  | "reportsGenerated"
  | "whatsappMessagesSent"
  | "teamMembers";

export class InMemoryUsageCounterStore implements UsageCounterStore {
  private readonly counters = new Map<string, number>();

  private key(workspaceId: string, metric: string, periodStart: Date) {
    return `${workspaceId}:${metric}:${periodStart.toISOString()}`;
  }

  async increment(workspaceId: string, metric: string, periodStart: Date, _periodEnd: Date, by = 1) {
    const key = this.key(workspaceId, metric, periodStart);
    const next = (this.counters.get(key) ?? 0) + by;
    this.counters.set(key, next);
    return next;
  }

  async get(workspaceId: string, metric: string, periodStart: Date) {
    return this.counters.get(this.key(workspaceId, metric, periodStart)) ?? 0;
  }
}
