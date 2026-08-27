import { randomUUID } from "node:crypto";
import {
  prisma,
  resolveFreshCredentials,
  upsertMarketplaceProduct,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import {
  createProvider,
  decryptSecret,
  encryptSecret,
  InMemoryTokenBucket,
  MarketplaceApiError,
  MarketplaceNotImplementedError,
  type ProviderCredentials,
} from "@mastershopee/integrations";
import type { MarketplaceSyncJobData } from "../queues.js";
import { getIntegrationEnv } from "../integration-env.js";

// One bucket per marketplace type, shared across all accounts of that
// marketplace within this worker process (§34). A production deployment
// running multiple worker replicas should swap this for RedisTokenBucket
// so the limit is enforced across processes too.
const rateLimiters = new Map<string, InMemoryTokenBucket>();
function getRateLimiter(marketplace: string): InMemoryTokenBucket {
  if (!rateLimiters.has(marketplace)) {
    rateLimiters.set(marketplace, new InMemoryTokenBucket(10, 5)); // 10 burst, 5/s sustained
  }
  return rateLimiters.get(marketplace)!;
}

export async function runMarketplaceSync(data: MarketplaceSyncJobData): Promise<void> {
  const account = await prisma.marketplaceAccount.findUnique({
    where: { id: data.marketplaceAccountId },
    include: { credential: true },
  });
  if (!account || !account.credential) {
    throw new Error(`MarketplaceAccount ${data.marketplaceAccountId} has no credentials — cannot sync.`);
  }

  // Idempotency / no-duplicate-sync lock (§34, §87): a unique lockKey means
  // a second sync of the same type for the same account fails fast on the
  // unique constraint instead of running concurrently.
  const lockKey = `${account.id}:${data.type}`;
  let syncRecord;
  try {
    syncRecord = await prisma.integrationSync.create({
      data: {
        workspaceId: account.workspaceId,
        marketplaceAccountId: account.id,
        type: data.type,
        status: "RUNNING",
        startedAt: new Date(),
        lockKey,
      },
    });
  } catch {
    // Another sync of this type for this account is already running/queued — skip, don't duplicate.
    return;
  }

  await prisma.marketplaceAccount.update({ where: { id: account.id }, data: { status: "SYNCING" } });

  const provider = createProvider(account.marketplace, getIntegrationEnv());

  const limiter = getRateLimiter(account.marketplace);
  let itemsProcessed = 0;

  let credentials: ProviderCredentials;
  try {
    // Mesma renovação que a aplicação web usa: o token da Shopee vale 4
    // horas e o refresh exige o shop_id junto.
    credentials = await resolveFreshCredentials({
      accountId: account.id,
      externalShopId: account.externalShopId,
      provider,
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    });
  } catch (err) {
    await prisma.integrationSync.update({
      where: { id: syncRecord.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : "credenciais indisponíveis",
        lockKey: null,
      },
    });
    await prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: { status: "TOKEN_EXPIRED", lastErrorMessage: err instanceof Error ? err.message : null },
    });
    return;
  }

  try {
    // ── Products ────────────────────────────────────────────────────
    let productCursor = { value: account.lastSyncCursor };
    let hasMoreProducts = true;
    while (hasMoreProducts) {
      await limiter.acquire(account.id);
      const page = await provider.fetchProducts(credentials, productCursor);
      for (const p of page.items) {
        await upsertMarketplaceProduct(account, {
          sku: p.sku,
          title: p.title,
          imageUrl: p.imageUrl,
          externalProductId: p.externalProductId,
          externalVariationId: p.externalVariationId,
        });
        itemsProcessed++;
      }
      productCursor = page.nextCursor;
      hasMoreProducts = page.hasMore;
    }

    // ── Orders (incremental — §36: only what changed since lastSyncAt) ─
    let orderCursor = { value: null as string | null };
    let hasMoreOrders = true;
    while (hasMoreOrders) {
      await limiter.acquire(account.id);
      const page = await provider.fetchOrders(credentials, orderCursor, account.lastSyncAt ?? undefined);
      for (const o of page.items) {
        await upsertNormalizedOrder(account, o);
        itemsProcessed++;
      }
      orderCursor = page.nextCursor;
      hasMoreOrders = page.hasMore;
    }

    // lockKey is cleared on every terminal state, not just success: it's a
    // unique column, so leaving it set here would mean this account+type
    // could never sync again after this one run — the lock only needs to
    // hold while status is RUNNING.
    await prisma.integrationSync.update({
      where: { id: syncRecord.id },
      data: { status: "COMPLETED", finishedAt: new Date(), itemsProcessed, cursor: orderCursor.value, lockKey: null },
    });
    await prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: { status: "CONNECTED", lastSyncAt: new Date(), lastSyncCursor: orderCursor.value, lastErrorMessage: null },
    });
  } catch (err) {
    const isNotImplemented = err instanceof MarketplaceNotImplementedError;
    const message = err instanceof Error ? err.message : "Erro desconhecido na sincronização.";
    const newStatus = err instanceof MarketplaceApiError && err.httpStatus === 401 ? "TOKEN_EXPIRED" : "ERROR";

    await prisma.integrationSync.update({
      where: { id: syncRecord.id },
      data: { status: itemsProcessed > 0 ? "PARTIAL" : "FAILED", finishedAt: new Date(), itemsProcessed, errorMessage: message, lockKey: null },
    });
    await prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: { status: newStatus, lastErrorMessage: message },
    });

    // Only notify on the transition into a failed state (§89 — friendly
    // wording, no raw error text) — otherwise every retry within BullMQ's
    // backoff window would spam a fresh notification for the same problem.
    if (account.status !== "ERROR" && account.status !== "TOKEN_EXPIRED") {
      await prisma.notification.create({
        data: {
          workspaceId: account.workspaceId,
          title: `${account.marketplace} parou de sincronizar`,
          body:
            newStatus === "TOKEN_EXPIRED"
              ? "Sua conexão expirou. Reconecte a conta em Integrações para continuar sincronizando."
              : "Houve um problema ao sincronizar esta conta. Veja os detalhes em Integrações.",
        },
      });
    }

    await prisma.integrationLog.create({
      data: {
        workspaceId: account.workspaceId,
        marketplaceAccountId: account.id,
        level: isNotImplemented ? "warn" : "error",
        message,
        context: { jobId: randomUUID(), type: data.type },
      },
    });

    if (!isNotImplemented) throw err; // let BullMQ retry real transient failures; don't retry "not implemented yet"
  }
}
