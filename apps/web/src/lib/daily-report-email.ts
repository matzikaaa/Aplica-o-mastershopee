import { collectLowStock, prisma } from "@mastershopee/database";
import { dailyReportParams, zonedTime } from "@mastershopee/shared";
import { sendDailyReportEmail } from "@/lib/email";

/**
 * Monta e envia o resumo diário por e-mail de um workspace.
 *
 * Compartilhado entre o cron e o botão de envio manual pela mesma razão de
 * sempre: dois compositores divergem, e aí o que o vendedor confere no botão
 * não é o que chega às 6h30.
 *
 * Os números vêm de `dailyReportParams`, o mesmo que alimenta o template do
 * WhatsApp — quem recebe pelos dois canais não pode ver valores diferentes.
 */
export interface EnvioResumo {
  status: "enviado" | "sem-dados" | "sem-destinatario" | "desativado";
  detalhe?: string;
}

export async function enviarResumoDiario(
  workspaceId: string,
  opts: { data?: Date; ignorarPreferencia?: boolean } = {},
): Promise<EnvioResumo> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      members: {
        where: { role: "OWNER" },
        include: { user: { select: { email: true } } },
        take: 1,
      },
    },
  });
  if (!workspace) return { status: "sem-destinatario", detalhe: "workspace não encontrado" };

  if (!opts.ignorarPreferencia && !workspace.dailyReportEmailEnabled) {
    return { status: "desativado" };
  }

  // Sem endereço próprio, vai para quem é dono. Exigir preencher um campo
  // para receber o próprio relatório seria atrito sem motivo.
  const destinatario = workspace.dailyReportEmailTo?.trim() || workspace.members[0]?.user.email;
  if (!destinatario) return { status: "sem-destinatario" };

  const hoje = zonedTime(workspace.timezone);
  hoje.setHours(0, 0, 0, 0);
  const alvo = opts.data ?? new Date(hoje.getTime() - 24 * 3600 * 1000);

  const metric = await prisma.dailyMetric.findUnique({
    where: { workspaceId_date: { workspaceId, date: alvo } },
  });
  // Sem métrica não há relatório: mandar zeros diria que o dia fechou sem
  // vendas, que é diferente de não haver dado sobre o dia.
  if (!metric) return { status: "sem-dados", detalhe: alvo.toLocaleDateString("pt-BR") };

  const [, faturamento, lucro, margem, pedidos, ads] = dailyReportParams(workspace.name, metric);
  const estoque = await collectLowStock(workspaceId);
  const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "";

  await sendDailyReportEmail({
    to: destinatario,
    workspaceName: workspace.name,
    periodo: alvo.toLocaleDateString("pt-BR"),
    faturamento: faturamento!,
    lucro: lucro!,
    margem: margem!,
    pedidos: pedidos!,
    ads: ads!,
    estoque: estoque.map((i) => ({
      sku: i.sku,
      quantity: i.quantity,
      daysOfCover: i.daysOfCover,
      isOutOfStock: i.isOutOfStock,
    })),
    painelUrl: `${baseUrl}/dashboard`,
  });

  return { status: "enviado", detalhe: destinatario };
}
