import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

const ALLOWED_TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Fortaleza"];

/** §41, §63 — company name/timezone. Timezone drives every daily aggregation and the WhatsApp scheduler. */
export async function POST(request: Request) {
  const { workspace, role } = await requireWorkspace();
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem alterar dados da empresa." }, { status: 403 });
  }

  const { name, timezone } = await request.json();
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
  }
  if (timezone && !ALLOWED_TIMEZONES.includes(timezone)) {
    return NextResponse.json({ error: "Fuso horário inválido." }, { status: 400 });
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { name: name.trim(), ...(timezone ? { timezone } : {}) },
  });

  return NextResponse.json({ ok: true });
}
