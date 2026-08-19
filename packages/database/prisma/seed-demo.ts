/**
 * OPT-IN demo data — every number this writes is synthetic.
 *
 * Deliberately NOT part of `pnpm db:seed` (which seeds only the real plan
 * catalog): an install should show honest empty states until real data
 * arrives from a real connected marketplace account. Run this only when you
 * want a populated environment to explore the UI (§75, §94).
 *
 * Everything it creates is labelled [DEMO] and can be removed later with
 * `pnpm db:purge:demo`. Note the marketplace accounts it creates are marked
 * CONNECTED without any real OAuth connection existing — one more reason
 * this must never touch a production database.
 *
 * Login: demo@mastershopee.app / demo12345
 */
import { PrismaClient, MarketplaceType, OrderStatus, MarketplaceAccountStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { scryptSync, randomBytes } from "node:crypto";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error(
    "Refusing to write synthetic demo data with NODE_ENV=production.\n" +
      "If this really is intended (e.g. a throwaway staging box), set ALLOW_DEMO_SEED=true.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const DEMO_PRODUCTS = [
  { sku: "ORG-TENIS-01", name: "[DEMO] Organizador de Tênis Transparente", cost: 14.9, price: 49.9 },
  { sku: "GARR-INOX-500", name: "[DEMO] Garrafa Térmica Inox 500ml", cost: 22.0, price: 79.9 },
  { sku: "FONE-BT-X2", name: "[DEMO] Fone de Ouvido Bluetooth X2", cost: 31.5, price: 69.9 },
  { sku: "LUM-LED-USB", name: "[DEMO] Luminária LED USB Flexível", cost: 9.8, price: 34.9 },
  { sku: "MOCHILA-ANTI", name: "[DEMO] Mochila Antifurto Impermeável", cost: 48.0, price: 129.9 },
];

const MARKETPLACES: { type: MarketplaceType; shopId: string; name: string }[] = [
  { type: "SHOPEE", shopId: "demo-shopee-shop", name: "[DEMO] Loja Shopee" },
  { type: "MERCADO_LIVRE", shopId: "demo-ml-shop", name: "[DEMO] Loja Mercado Livre" },
  { type: "SHEIN", shopId: "demo-shein-shop", name: "[DEMO] Loja SHEIN" },
  { type: "TIKTOK_SHOP", shopId: "demo-tiktok-shop", name: "[DEMO] Loja TikTok Shop" },
];

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

async function main() {
  console.log("Seeding demo data (clearly marked with [DEMO] prefixes)...");

  const plans = await Promise.all([
    prisma.plan.upsert({
      where: { code: "STARTER" },
      update: {},
      create: {
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
    }),
    prisma.plan.upsert({
      where: { code: "PRO" },
      update: {},
      create: {
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
    }),
    prisma.plan.upsert({
      where: { code: "SCALE" },
      update: {},
      create: {
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
    }),
  ]);
  const proPlan = plans.find((p) => p.code === "PRO")!;

  // Reset the credentials on every run rather than `update: {}`. This seed
  // advertises a specific login, so it has to guarantee that login works —
  // if the address was already taken (e.g. someone registered it by hand
  // through /register, with their own password and no verified e-mail), a
  // no-op update leaves an account that silently rejects the documented
  // password, which is worse than not seeding at all.
  const user = await prisma.user.upsert({
    where: { email: "demo@mastershopee.app" },
    update: {
      name: "Marcos (Demo)",
      passwordHash: hashPassword("demo12345"),
      emailVerifiedAt: new Date(),
    },
    create: {
      email: "demo@mastershopee.app",
      name: "Marcos (Demo)",
      passwordHash: hashPassword("demo12345"),
      emailVerifiedAt: new Date(),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "[DEMO] Minha Loja",
      slug: "demo",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      onboardingCompletedAt: new Date(),
      members: {
        create: { userId: user.id, role: "OWNER", joinedAt: new Date() },
      },
    },
  });

  await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      planId: proPlan.id,
      status: "active",
      interval: "monthly",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  const accounts = [];
  for (const mp of MARKETPLACES) {
    const account = await prisma.marketplaceAccount.upsert({
      where: {
        workspaceId_marketplace_externalShopId: {
          workspaceId: workspace.id,
          marketplace: mp.type,
          externalShopId: mp.shopId,
        },
      },
      update: {},
      create: {
        workspaceId: workspace.id,
        marketplace: mp.type,
        externalShopId: mp.shopId,
        displayName: mp.name,
        status: MarketplaceAccountStatus.CONNECTED,
        lastSyncAt: new Date(),
        connectedAt: new Date(),
      },
    });
    accounts.push(account);
  }

  const products = [];
  for (const p of DEMO_PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { workspaceId_sku: { workspaceId: workspace.id, sku: p.sku } },
      update: {},
      create: { workspaceId: workspace.id, sku: p.sku, name: p.name },
    });
    await prisma.productCost.create({
      data: {
        productId: product.id,
        unitCost: p.cost,
        packagingCost: 1.5,
        operationalCost: 0.8,
        taxPercent: 6,
        otherCosts: 0,
        effectiveFrom: new Date(Date.now() - 90 * 24 * 3600 * 1000),
      },
    });
    products.push({ ...p, id: product.id });
  }

  // 30 days of orders spread across marketplaces/products, with one product
  // deliberately unprofitable (heavy discount + high ad spend) to populate
  // the "produtos dando prejuízo" section.
  const days = 30;
  for (let d = days; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);

    for (const account of accounts) {
      const ordersToday = Math.floor(rand(2, 9));
      for (let i = 0; i < ordersToday; i++) {
        const product = products[Math.floor(rand(0, products.length))]!;
        const isLossLeader = product.sku === "ORG-TENIS-01" && Math.random() < 0.6;
        const quantity = Math.floor(rand(1, 4));
        const unitPrice = isLossLeader ? product.price * 0.65 : product.price;
        const grossAmount = unitPrice * quantity;
        const commission = grossAmount * 0.14;
        const marketplaceFee = grossAmount * 0.03;
        const shipping = rand(4, 12) * quantity;
        const tax = grossAmount * 0.06;
        const adSpend = isLossLeader ? grossAmount * 0.35 : grossAmount * rand(0.05, 0.15);

        const orderedAt = new Date(date);
        orderedAt.setHours(Math.floor(rand(8, 22)), Math.floor(rand(0, 59)));

        const order = await prisma.order.create({
          data: {
            workspaceId: workspace.id,
            marketplaceAccountId: account.id,
            marketplace: account.marketplace,
            externalOrderId: `DEMO-${account.marketplace}-${randomUUID().slice(0, 8)}`,
            status: OrderStatus.DELIVERED,
            orderedAt,
            grossAmount,
            commissionAmount: commission,
            marketplaceFeeAmount: marketplaceFee,
            shippingSubsidizedByMerchant: shipping,
            taxAmount: tax,
            adSpendAttributed: adSpend,
            items: {
              create: {
                productId: product.id,
                externalSku: product.sku,
                title: product.name,
                quantity,
                unitPrice,
                unitCostSnapshot: product.cost,
                commissionAmount: commission,
                feeAmount: marketplaceFee,
                adSpendAttributed: adSpend,
                taxAmount: tax,
              },
            },
          },
        });

        const productCost = product.cost * quantity + 1.5 * quantity;
        const netProfit =
          grossAmount - commission - marketplaceFee - shipping - tax - adSpend - productCost;

        await prisma.financialTransaction.create({
          data: {
            workspaceId: workspace.id,
            orderId: order.id,
            type: "SALE",
            amount: grossAmount,
            occurredAt: orderedAt,
            description: "Venda registrada via sincronização demo",
          },
        });
      }
    }

    // Pre-aggregate the day (mirrors what the compute-daily-metrics worker job does).
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dayOrders = await prisma.order.findMany({
      where: { workspaceId: workspace.id, orderedAt: { gte: startOfDay, lte: endOfDay } },
      include: { items: true },
    });

    let grossRevenue = 0,
      productCost = 0,
      commission = 0,
      marketplaceFees = 0,
      shippingTotal = 0,
      adSpendTotal = 0,
      taxes = 0;

    for (const o of dayOrders) {
      grossRevenue += Number(o.grossAmount);
      commission += Number(o.commissionAmount);
      marketplaceFees += Number(o.marketplaceFeeAmount);
      shippingTotal += Number(o.shippingSubsidizedByMerchant);
      adSpendTotal += Number(o.adSpendAttributed);
      taxes += Number(o.taxAmount);
      for (const item of o.items) {
        productCost += Number(item.unitCostSnapshot ?? 0) * item.quantity;
      }
    }

    const grossProfit = grossRevenue - productCost;
    const netProfit = grossProfit - commission - marketplaceFees - shippingTotal - adSpendTotal - taxes;

    if (dayOrders.length > 0) {
      await prisma.dailyMetric.upsert({
        where: { workspaceId_date: { workspaceId: workspace.id, date: startOfDay } },
        update: {},
        create: {
          workspaceId: workspace.id,
          date: startOfDay,
          grossRevenue,
          netRevenue: grossRevenue,
          productCost,
          commission,
          marketplaceFees,
          shipping: shippingTotal,
          adSpend: adSpendTotal,
          taxes,
          refunds: 0,
          otherCosts: 0,
          grossProfit,
          netProfit,
          orderCount: dayOrders.length,
          dataQuality: "complete",
        },
      });
    }
  }

  console.log("Demo seed complete — every figure above is synthetic, not real sales data.");
  console.log("Login: demo@mastershopee.app / demo12345");
  console.log("Remove it later with: pnpm db:purge:demo");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
