/**
 * Production-safe seed: the plan catalog only.
 *
 * This is real configuration the app needs to function (a workspace can't
 * have a subscription without a plan to point at), not sample data — it
 * creates no users, no marketplace accounts, no orders and no metrics.
 * A freshly seeded install therefore shows genuine empty states everywhere
 * until real data arrives from a real connected account (§75, §94).
 *
 * For a populated demo environment, run `pnpm db:seed:demo` instead —
 * that one is explicitly opt-in and everything it writes is [DEMO]-labelled
 * and removable with `pnpm db:purge:demo`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding plan catalog (no sample data)...");

  await prisma.plan.upsert({
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
  });

  await prisma.plan.upsert({
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
  });

  await prisma.plan.upsert({
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
  });

  console.log("Plan catalog ready. No demo/sample data was created.");
  console.log("Create your account at /register — the dashboard stays empty until a real marketplace account is connected.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
