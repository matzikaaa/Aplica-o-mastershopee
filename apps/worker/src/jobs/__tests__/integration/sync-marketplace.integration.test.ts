import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@mastershopee/database";
import { encryptSecret } from "@mastershopee/integrations";
import { runMarketplaceSync } from "../../sync-marketplace.js";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

// SHEIN is used deliberately: SheinProvider.fetchProducts throws
// MarketplaceNotImplementedError synchronously with no network call (real
// credentials aren't configured in this environment), which keeps the test
// fast and deterministic while still exercising the real idempotency lock
// against a real Postgres unique constraint.
describe("runMarketplaceSync — idempotency lock under real concurrency (§34, §87)", () => {
  let workspaceId: string | undefined;

  afterEach(async () => {
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  it("skips a sync when another sync of the same account+type is already RUNNING", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace("SHEIN");
    workspaceId = workspace.id;

    await prisma.marketplaceCredential.create({
      data: { marketplaceAccountId: marketplaceAccount.id, encryptedAccessToken: encryptSecret("fake-token") },
    });

    const data = { marketplaceAccountId: marketplaceAccount.id, type: "FULL" as const };
    const lockKey = `${marketplaceAccount.id}:FULL`;

    // Simulates a sync that's genuinely in flight (e.g. from another worker
    // process/replica) by holding the same lockKey the real function would
    // try to acquire. A true concurrent Promise.all race isn't reliably
    // observable at this scale — Prisma serializes both create() calls over
    // one connection fast enough that they rarely actually overlap — so
    // this pins down the exact mechanism (the unique-constraint skip path)
    // deterministically instead.
    const inFlight = await prisma.integrationSync.create({
      data: { workspaceId: workspace.id, marketplaceAccountId: marketplaceAccount.id, type: "FULL", status: "RUNNING", startedAt: new Date(), lockKey },
    });

    await runMarketplaceSync(data);

    const syncs = await prisma.integrationSync.findMany({
      where: { marketplaceAccountId: marketplaceAccount.id, type: "FULL" },
    });
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.id).toBe(inFlight.id);
    expect(syncs[0]!.status).toBe("RUNNING"); // untouched — the skip path never reaches the update() calls

    const account = await prisma.marketplaceAccount.findUniqueOrThrow({ where: { id: marketplaceAccount.id } });
    expect(account.status).toBe("CONNECTED"); // unchanged from its initial state — never touched either
  });

  it("allows a second sync of the same account+type once the first has finished", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace("SHEIN");
    workspaceId = workspace.id;

    await prisma.marketplaceCredential.create({
      data: { marketplaceAccountId: marketplaceAccount.id, encryptedAccessToken: encryptSecret("fake-token") },
    });

    const data = { marketplaceAccountId: marketplaceAccount.id, type: "FULL" as const };

    await runMarketplaceSync(data);
    await runMarketplaceSync(data); // sequential, not concurrent — the lock from the first run is already released

    const syncs = await prisma.integrationSync.findMany({
      where: { marketplaceAccountId: marketplaceAccount.id, type: "FULL" },
    });
    expect(syncs).toHaveLength(2);
  });
});
