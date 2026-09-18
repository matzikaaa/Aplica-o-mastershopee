import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/** Preferência do resumo diário por e-mail. */
export async function POST(request: Request) {
  const { workspace, role } = await requireWorkspace();
  if (role === "VIEWER") {
    return NextResponse.json({ error: "Sem permissão para alterar configurações." }, { status: 403 });
  }

  const body = (await request.json()) as { enabled?: boolean; to?: string };
  const to = body.to?.trim();

  // Endereço vazio significa "manda para o dono", não "endereço inválido".
  if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      dailyReportEmailEnabled: Boolean(body.enabled),
      dailyReportEmailTo: to || null,
    },
  });

  return NextResponse.json({ ok: true });
}
