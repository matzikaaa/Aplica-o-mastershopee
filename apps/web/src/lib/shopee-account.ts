import { prisma } from "@mastershopee/database";

/**
 * A conta Shopee que vale usar.
 *
 * Uma tentativa de conexão que falhou no meio deixa uma conta órfã para trás,
 * sem token. Escolher a errada faz a importação falhar por "sem token" com a
 * conta boa ali do lado — e as duas falhas parecem a mesma na tela, então
 * elas são separadas aqui.
 */
export async function resolveShopeeAccount(workspaceId: string) {
  const account = await prisma.marketplaceAccount.findFirst({
    where: {
      workspaceId,
      marketplace: "SHOPEE",
      status: { not: "DISCONNECTED" },
      credential: { isNot: null },
    },
    orderBy: [{ connectedAt: "desc" }, { createdAt: "desc" }],
  });

  if (account) return account;

  const semToken = await prisma.marketplaceAccount.findFirst({
    where: { workspaceId, marketplace: "SHOPEE" },
  });

  return semToken
    ? {
        error:
          "A conta Shopee existe, mas está sem token salvo — a autorização não foi concluída. Conecte novamente.",
        status: 409 as const,
      }
    : { error: "Nenhuma conta Shopee conectada neste workspace.", status: 404 as const };
}
