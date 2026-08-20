import { prisma, type MarketplaceType } from "@mastershopee/database";

/**
 * Orders and ad spend must hang off a MarketplaceAccount, but imported data
 * has no OAuth connection behind it. Rather than borrowing a real connected
 * account (which would make hand-loaded rows look synced), imports get their
 * own account per marketplace, named for what it is and left
 * NOT_CONNECTED — so the Integrations page keeps telling the truth about
 * what is actually connected (§61, §96).
 */
export async function ensureImportAccount(workspaceId: string, marketplace: MarketplaceType) {
  const externalShopId = `manual-import:${marketplace.toLowerCase()}`;

  return prisma.marketplaceAccount.upsert({
    where: {
      workspaceId_marketplace_externalShopId: { workspaceId, marketplace, externalShopId },
    },
    update: {},
    create: {
      workspaceId,
      marketplace,
      externalShopId,
      displayName: "Importação manual (planilha)",
      status: "NOT_CONNECTED",
    },
  });
}
