/**
 * Removes everything `pnpm db:seed:demo` created, so a database that was
 * explored with sample data can be returned to an honest empty state before
 * real marketplace accounts are connected (§75, §94).
 *
 * Scoped strictly to the demo workspace (slug "demo") and the demo user —
 * every order, product, metric and marketplace account hangs off the
 * workspace and cascades with it, so real workspaces in the same database
 * are untouched. Prints what it will delete and leaves the plan catalog
 * (real configuration) alone.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_WORKSPACE_SLUG = "demo";
const DEMO_USER_EMAIL = "demo@mastershopee.app";

async function main() {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: DEMO_WORKSPACE_SLUG },
    include: {
      _count: { select: { orders: true, products: true, marketplaceAccounts: true, dailyMetrics: true } },
    },
  });

  if (!workspace) {
    console.log(`No workspace with slug "${DEMO_WORKSPACE_SLUG}" found — nothing to purge.`);
  } else {
    console.log(`Deleting demo workspace "${workspace.name}":`);
    console.log(`  ${workspace._count.orders} orders`);
    console.log(`  ${workspace._count.products} products`);
    console.log(`  ${workspace._count.marketplaceAccounts} marketplace accounts`);
    console.log(`  ${workspace._count.dailyMetrics} daily metrics`);
    // Every child row cascades from Workspace (see schema.prisma).
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }

  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (user) {
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`Deleted demo user ${DEMO_USER_EMAIL}.`);
  }

  console.log("Done. The plan catalog was left in place — it is real configuration, not demo data.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
