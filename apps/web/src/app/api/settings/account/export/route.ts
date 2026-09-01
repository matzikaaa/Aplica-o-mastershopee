import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/**
 * Exportação dos dados do titular (LGPD art. 18, II e V).
 *
 * Devolve o que a aplicação guarda sobre a pessoa e sobre a operação dela,
 * em JSON, num arquivo só. Não é um relatório de negócio — é a resposta a
 * "me mostre tudo que vocês têm sobre mim", e por isso inclui o que o
 * dashboard normalmente esconde: logs de auditoria, tokens de integração
 * (só os metadados, nunca o segredo) e configurações.
 */
export async function GET() {
  const { workspace, user } = await requireWorkspace();

  const [
    perfil,
    assinatura,
    contas,
    produtos,
    custos,
    pedidos,
    metricas,
    whatsapp,
    auditoria,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, createdAt: true, emailVerifiedAt: true },
    }),
    prisma.subscription.findUnique({
      where: { workspaceId: workspace.id },
      include: { plan: { select: { code: true, name: true } } },
    }),
    prisma.marketplaceAccount.findMany({
      where: { workspaceId: workspace.id },
      // As credenciais ficam de fora de propósito: exportar o token cifrado
      // não ajuda o titular e cria uma cópia do segredo fora do banco.
      select: {
        marketplace: true,
        externalShopId: true,
        displayName: true,
        status: true,
        connectedAt: true,
        lastSyncAt: true,
      },
    }),
    prisma.product.findMany({ where: { workspaceId: workspace.id } }),
    prisma.productCost.findMany({ where: { product: { workspaceId: workspace.id } } }),
    prisma.order.findMany({
      where: { workspaceId: workspace.id },
      include: { items: true },
    }),
    prisma.dailyMetric.findMany({ where: { workspaceId: workspace.id } }),
    prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } }),
    prisma.auditLog.findMany({ where: { workspaceId: workspace.id }, take: 5000, orderBy: { createdAt: "desc" } }),
  ]);

  const payload = {
    geradoEm: new Date().toISOString(),
    workspace: { id: workspace.id, nome: workspace.name, timezone: workspace.timezone },
    perfil,
    assinatura,
    contasDeMarketplace: contas,
    produtos,
    custos,
    pedidos,
    metricasDiarias: metricas,
    whatsapp,
    registrosDeAuditoria: auditoria,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mastershopee-${workspace.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
