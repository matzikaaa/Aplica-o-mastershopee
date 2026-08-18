import { randomUUID } from "node:crypto";
import { prisma, type MarketplaceType } from "@mastershopee/database";

/**
 * Creates a throwaway workspace (+ one marketplace account) for a single
 * integration test to seed data into. Every child row (orders, metrics,
 * alerts, syncs...) cascades from Workspace in the schema, so cleanup() is
 * a single delete regardless of what the test created underneath it.
 */
export async function createTestWorkspace(marketplace: MarketplaceType = "MERCADO_LIVRE") {
  const slug = `test-${randomUUID()}`;
  const workspace = await prisma.workspace.create({
    data: { name: `Integration Test ${slug}`, slug, currency: "BRL" },
  });
  const marketplaceAccount = await prisma.marketplaceAccount.create({
    data: {
      workspaceId: workspace.id,
      marketplace,
      externalShopId: `ext-${randomUUID()}`,
      displayName: "Test Account",
      status: "CONNECTED",
    },
  });
  return { workspace, marketplaceAccount };
}

export async function cleanupTestWorkspace(workspaceId: string) {
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {
    // already gone — fine, some tests delete it themselves to test cascade behavior
  });
}
