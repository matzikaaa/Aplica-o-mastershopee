import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { captureError } from "@/lib/observability";

/**
 * Exclusão da conta e de todos os dados (LGPD art. 18, VI).
 *
 * Apaga de verdade, não marca como inativo: o titular pediu eliminação, e
 * "desativado mas guardado" não é eliminação. O cascade do schema leva
 * pedidos, produtos, custos, métricas, credenciais e logs junto com o
 * workspace.
 *
 * Exige o nome do workspace digitado. É destrutivo e irreversível, e um
 * clique de confirmação genérico não distingue intenção de acidente.
 *
 * Só o OWNER pode: um membro convidado apagando a operação inteira seria
 * escalonamento de privilégio disfarçado de exercício de direito.
 */
export async function POST(request: Request) {
  const { workspace, user, role } = await requireWorkspace();

  if (role !== "OWNER") {
    return NextResponse.json(
      { error: "Só o proprietário do workspace pode excluir a conta." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { confirmacao?: string };
  if (body.confirmacao?.trim() !== workspace.name) {
    return NextResponse.json(
      { error: `Para confirmar, digite exatamente o nome do workspace: ${workspace.name}` },
      { status: 400 },
    );
  }

  try {
    // O usuário sai junto quando este era o único workspace dele — deixar a
    // pessoa sem workspace nenhum produziria uma conta que loga e não tem
    // para onde ir.
    const outros = await prisma.workspaceMember.count({
      where: { userId: user.id, workspaceId: { not: workspace.id } },
    });

    await prisma.$transaction(async (tx) => {
      await tx.workspace.delete({ where: { id: workspace.id } });
      if (outros === 0) {
        await tx.user.delete({ where: { id: user.id } });
      }
    });

    return NextResponse.json({ ok: true, usuarioRemovido: outros === 0 });
  } catch (err) {
    captureError(err, { route: "settings.account.delete", workspaceId: workspace.id });
    return NextResponse.json(
      { error: "Não foi possível concluir a exclusão. Nada foi apagado — tente novamente ou fale com o suporte." },
      { status: 500 },
    );
  }
}
