import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { prisma } from "@mastershopee/database";
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

/**
 * Resolves the ProductCost that was effective on `orderedAt` — never the
 * current cost (§16). A product with no cost history yet returns zero,
 * which the dashboard surfaces as "lucro estimado incompleto" (§96)
 * rather than silently treating it as free.
 */
async function resolveCostSnapshot(productId: string, orderedAt: Date): Promise<Decimal> {
  const cost = await prisma.productCost.findFirst({
    where: { productId, effectiveFrom: { lte: orderedAt } },
    orderBy: { effectiveFrom: "desc" },
  });
  return cost ? new Decimal(cost.unitCost) : new Decimal(0);
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
  const credentials: ProviderCredentials = {
    accessToken: decryptSecret(account.credential.encryptedAccessToken),
    refreshToken: account.credential.encryptedRefreshToken ? decryptSecret(account.credential.encryptedRefreshToken) : undefined,
    externalShopId: account.externalShopId,
  };

  const limiter = getRateLimiter(account.marketplace);
  let itemsProcessed = 0;

  try {
    // Refresh the access token proactively if it's near expiry.
    if (account.credential.accessTokenExpiresAt && account.credential.accessTokenExpiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      if (credentials.refreshToken) {
        await limiter.acquire(account.id);
        const refreshed = await provider.refreshAccessToken(credentials.refreshToken);
        credentials.accessToken = refreshed.accessToken;
        await prisma.marketplaceCredential.update({
          where: { marketplaceAccountId: account.id },
          data: {
            encryptedAccessToken: encryptSecret(refreshed.accessToken),
            encryptedRefreshToken: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : undefined,
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            rotatedAt: new Date(),
          },
        });
      }
    }

    // ── Products ────────────────────────────────────────────────────
    let productCursor = { value: account.lastSyncCursor };
    let hasMoreProducts = true;
    while (hasMoreProducts) {
      await limiter.acquire(account.id);
      const page = await provider.fetchProducts(credentials, productCursor);
      for (const p of page.items) {
        const product = await prisma.product.upsert({
          where: { workspaceId_sku: { workspaceId: account.workspaceId, sku: p.sku } },
          update: { name: p.title, imageUrl: p.imageUrl },
          create: { workspaceId: account.workspaceId, sku: p.sku, name: p.title, imageUrl: p.imageUrl },
        });
        await prisma.marketplaceProduct.upsert({
          where: {
            marketplaceAccountId_externalProductId_externalVariationId: {
              marketplaceAccountId: account.id,
              externalProductId: p.externalProductId,
              externalVariationId: p.externalVariationId ?? "",
            },
          },
          update: { title: p.title },
          create: {
            productId: product.id,
            marketplaceAccountId: account.id,
            externalProductId: p.externalProductId,
            externalVariationId: p.externalVariationId ?? "",
            title: p.title,
          },
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
        const order = await prisma.order.upsert({
          where: { marketplaceAccountId_externalOrderId: { marketplaceAccountId: account.id, externalOrderId: o.externalOrderId } },
          update: {
            status: o.status,
            grossAmount: o.grossAmount,
            discountAmount: o.discountAmount,
            shippingChargedToBuyer: o.shippingChargedToBuyer,
            shippingSubsidizedByMerchant: o.shippingSubsidizedByMerchant,
            commissionAmount: o.commissionAmount,
            marketplaceFeeAmount: o.marketplaceFeeAmount,
            taxAmount: o.taxAmount,
            rawPayload: JSON.parse(JSON.stringify(o.raw ?? {})),
          },
          create: {
            workspaceId: account.workspaceId,
            marketplaceAccountId: account.id,
            marketplace: account.marketplace,
            externalOrderId: o.externalOrderId,
            status: o.status,
            orderedAt: o.orderedAt,
            currency: o.currency,
            grossAmount: o.grossAmount,
            discountAmount: o.discountAmount,
            shippingChargedToBuyer: o.shippingChargedToBuyer,
            shippingSubsidizedByMerchant: o.shippingSubsidizedByMerchant,
            commissionAmount: o.commissionAmount,
            marketplaceFeeAmount: o.marketplaceFeeAmount,
            taxAmount: o.taxAmount,
            rawPayload: JSON.parse(JSON.stringify(o.raw ?? {})),
          },
        });

        for (const item of o.items) {
          const product = await prisma.product.findUnique({
            where: { workspaceId_sku: { workspaceId: account.workspaceId, sku: item.externalSku } },
          });
          const unitCostSnapshot = product ? await resolveCostSnapshot(product.id, o.orderedAt) : new Decimal(0);

          await prisma.orderItem.upsert({
            where: { id: `${order.id}:${item.externalSku}:${item.externalVariationId ?? ""}` },
            update: {},
            create: {
              id: `${order.id}:${item.externalSku}:${item.externalVariationId ?? ""}`,
              orderId: order.id,
              productId: product?.id,
              externalSku: item.externalSku,
              title: item.title,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unitCostSnapshot,
              commissionAmount: item.commissionAmount,
              feeAmount: item.feeAmount,
              taxAmount: item.taxAmount,
            },
          });
        }
        itemsProcessed++;
      }
      orderCursor = page.nextCursor;
      hasMoreOrders = page.hasMore;
    }

    await prisma.integrationSync.update({
      where: { id: syncRecord.id },
      data: { status: "COMPLETED", finishedAt: new Date(), itemsProcessed, cursor: orderCursor.value },
    });
    await prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: { status: "CONNECTED", lastSyncAt: new Date(), lastSyncCursor: orderCursor.value, lastErrorMessage: null },
    });
  } catch (err) {
    const isNotImplemented = err instanceof MarketplaceNotImplementedError;
    const message = err instanceof Error ? err.message : "Erro desconhecido na sincronização.";

    await prisma.integrationSync.update({
      where: { id: syncRecord.id },
      data: { status: itemsProcessed > 0 ? "PARTIAL" : "FAILED", finishedAt: new Date(), itemsProcessed, errorMessage: message },
    });
    await prisma.marketplaceAccount.update({
      where: { id: account.id },
      data: {
        status: err instanceof MarketplaceApiError && err.httpStatus === 401 ? "TOKEN_EXPIRED" : "ERROR",
        lastErrorMessage: message,
      },
    });
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
