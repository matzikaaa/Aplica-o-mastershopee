import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/session";
import { enviarResumoDiario } from "@/lib/daily-report-email";
import { isEmailConfigured } from "@/lib/email";
import { captureError } from "@/lib/observability";

/** Envia o resumo de ontem por e-mail agora, com os números reais. */
export async function POST() {
  const { workspace } = await requireWorkspace();

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Envio de e-mail não configurado neste ambiente." }, { status: 400 });
  }

  try {
    // Ignora a preferência: quem clicou está pedindo agora, e recusar por
    // causa de um interruptor de agendamento seria obedecer à configuração
    // errada.
    const r = await enviarResumoDiario(workspace.id, { ignorarPreferencia: true });

    if (r.status === "sem-dados") {
      return NextResponse.json(
        { error: `Ainda não há dados fechados para ${r.detalhe}. Importe os pedidos primeiro.` },
        { status: 409 },
      );
    }
    if (r.status === "sem-destinatario") {
      return NextResponse.json({ error: "Nenhum destinatário definido para o resumo." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, to: r.detalhe });
  } catch (err) {
    captureError(err, { route: "settings.email.send-report", workspaceId: workspace.id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao enviar o resumo." },
      { status: 400 },
    );
  }
}
