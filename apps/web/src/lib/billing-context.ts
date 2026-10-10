import { prisma } from "@mastershopee/database";
import { isStripeConfigured } from "./stripe";
import {
  PLAN_ORDER,
  PlanPermissionService,
  statusEfetivo,
  type WorkspaceBillingContext,
  type PlanCode,
} from "@mastershopee/billing";
import type { MarketplaceType } from "@mastershopee/shared";

/**
 * Builds the billing context PlanPermissionService needs from live
 * database state. This is the only place that translates DB rows into
 * the service's input — everywhere else in the app calls the service,
 * never re-derives plan checks by hand (§28).
 */
export async function getPlanPermissionService(workspaceId: string): Promise<PlanPermissionService> {
  const [subscription, accounts, memberCount, ordersThisMonth] = await Promise.all([
    prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true } }),
    prisma.marketplaceAccount.groupBy({
      by: ["marketplace"],
      where: { workspaceId, status: { not: "DISCONNECTED" } },
      _count: true,
    }),
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.order.count({
      // Meia-noite do dia 1, não "dia 1 neste horário": `setDate(1)` mantém a
      // hora atual, e os pedidos do primeiro dia do mês feitos antes dela
      // ficavam fora da contagem do limite do plano.
      where: { workspaceId, orderedAt: { gte: inicioDoMes() } },
    }),
  ]);

  const marketplaceAccountCountsByType = Object.fromEntries(
    accounts.map((a) => [a.marketplace, a._count]),
  ) as Partial<Record<MarketplaceType, number>>;

  // Cortesia ganha os limites do plano mais alto: liberar o acesso e manter o
  // teto do plano mais barato faria o dono da plataforma esbarrar no limite de
  // pedidos do próprio produto.
  const cortesia = await workspaceEmCortesia(workspaceId);

  const ctx: WorkspaceBillingContext = {
    planCode: cortesia
      ? (PLAN_ORDER[PLAN_ORDER.length - 1] as PlanCode)
      : ((subscription?.plan.code as PlanCode) ?? "STARTER"),
    subscriptionStatus: await statusDeAcesso(workspaceId, subscription),
    marketplaceAccountCountsByType,
    teamMemberCount: memberCount,
    ordersThisMonth,
  };

  return new PlanPermissionService(ctx);
}

function inicioDoMes(): Date {
  const hoje = new Date();
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
}

/**
 * O status que decide o acesso deste workspace agora.
 *
 * Três regras, nesta ordem:
 *
 * 1. **Cortesia** sempre tem acesso. É o dono da plataforma usando o próprio
 *    produto, ou quem ele escolher liberar — um beta tester, um parceiro.
 *    Sem isto, encerrar o teste grátis trancaria o dono do lado de fora no
 *    primeiro deploy.
 * 2. **Sem meio de pagamento configurado, teste não vence.** Bloquear alguém
 *    que não tem como pagar não protege receita nenhuma; só torna o produto
 *    inutilizável. Configurar o Stripe é o que liga o encerramento.
 * 3. Fora disso, vale o status efetivo: teste vencido é `expired`, mesmo que
 *    a linha ainda diga `trialing`.
 */
export async function statusDeAcesso(
  workspaceId: string,
  subscription: Parameters<typeof statusEfetivo>[0] | null,
) {
  if (await workspaceEmCortesia(workspaceId)) return "active" as const;
  if (!subscription) return "incomplete" as const;
  if (!isStripeConfigured()) return subscription.status;
  return statusEfetivo(subscription);
}

/**
 * Workspace liberado sem cobrança: algum dono dele é super admin ou tem o
 * e-mail em `ACESSO_CORTESIA_EMAILS` (lista separada por vírgula).
 *
 * Variável de ambiente, e não um campo no banco, porque é o que o dono da
 * plataforma consegue mudar sem ferramenta nenhuma — e fica auditável no
 * histórico de configuração da Vercel.
 */
export async function workspaceEmCortesia(workspaceId: string): Promise<boolean> {
  const emails = (process.env.ACESSO_CORTESIA_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const dono = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      role: "OWNER",
      user: {
        OR: [{ isSuperAdmin: true }, ...(emails.length > 0 ? [{ email: { in: emails } }] : [])],
      },
    },
    select: { id: true },
  });
  return dono !== null;
}
