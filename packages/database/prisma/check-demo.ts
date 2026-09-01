import { prisma } from "../src/index";

/**
 * Diz se ainda há dados de demonstração no banco apontado por DATABASE_URL.
 *
 * O seed de demonstração cria workspaces e pedidos plausíveis para exercitar
 * o painel. Plausíveis é justamente o problema: em produção eles não se
 * distinguem de dados reais olhando a tela, e um cliente novo veria números
 * que não são dele.
 *
 * Só relata — apagar é `pnpm db:purge:demo`, que é destrutivo e não deve
 * acontecer como efeito colateral de uma verificação.
 */
async function main() {
  const [workspaces, usuarios] = await Promise.all([
    prisma.workspace.findMany({
      where: { OR: [{ slug: { startsWith: "demo" } }, { name: { contains: "Demo" } }] },
      select: { id: true, name: true, slug: true, _count: { select: { orders: true, products: true } } },
    }),
    prisma.user.findMany({
      where: { email: { endsWith: "@exemplo.com" } },
      select: { email: true },
    }),
  ]);

  if (workspaces.length === 0 && usuarios.length === 0) {
    console.log("✓ Nenhum dado de demonstração encontrado neste banco.");
    return;
  }

  console.log("⚠ Dados de demonstração presentes:");
  for (const w of workspaces) {
    console.log(`  workspace "${w.name}" (${w.slug}) — ${w._count.orders} pedidos, ${w._count.products} produtos`);
  }
  for (const u of usuarios) {
    console.log(`  usuário ${u.email}`);
  }
  console.log("\nPara remover: pnpm db:purge:demo");
  process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
