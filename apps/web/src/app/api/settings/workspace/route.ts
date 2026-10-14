import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { REGIMES_TRIBUTARIOS, cnpjValido, cpfValido, somenteDigitos } from "@mastershopee/shared";

const ALLOWED_TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Fortaleza"];

/** §41, §63 — company name/timezone. Timezone drives every daily aggregation and the WhatsApp scheduler. */
export async function POST(request: Request) {
  const { workspace, role } = await requireWorkspace();
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem alterar dados da empresa." }, { status: 403 });
  }

  const { name, timezone, legalName, taxId, taxRegime } = await request.json();
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
  }
  if (timezone && !ALLOWED_TIMEZONES.includes(timezone)) {
    return NextResponse.json({ error: "Fuso horário inválido." }, { status: 400 });
  }

  // Dados para o contador: opcionais, mas, quando informados, certos.
  const documento = typeof taxId === "string" ? somenteDigitos(taxId) : "";
  if (documento && !cnpjValido(documento) && !cpfValido(documento)) {
    return NextResponse.json({ error: "CNPJ ou CPF inválido — confira os dígitos." }, { status: 400 });
  }
  if (taxRegime && (typeof taxRegime !== "string" || !Object.keys(REGIMES_TRIBUTARIOS).includes(taxRegime))) {
    return NextResponse.json({ error: "Regime tributário inválido." }, { status: 400 });
  }
  const razaoSocial = typeof legalName === "string" ? legalName.trim().slice(0, 150) : "";

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      name: name.trim(),
      ...(timezone ? { timezone } : {}),
      // Só o que veio: uma aba aberta antes desta versão manda nome e fuso, e
      // não pode apagar o CNPJ salvo depois.
      ...(legalName !== undefined ? { legalName: razaoSocial || null } : {}),
      ...(taxId !== undefined ? { taxId: documento || null } : {}),
      ...(taxRegime !== undefined ? { taxRegime: taxRegime || null } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
