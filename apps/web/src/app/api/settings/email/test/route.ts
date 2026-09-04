import { NextResponse } from "next/server";
import { sendTestEmail, isEmailConfigured } from "@/lib/email";
import { requireUser } from "@/lib/session";
import { captureError } from "@/lib/observability";

/**
 * Manda um e-mail de verdade para o próprio operador.
 *
 * SMTP configurado e SMTP entregando são coisas diferentes: credencial
 * errada, remetente não verificado no provedor, domínio sem DNS — tudo isso
 * passa pela configuração e falha na entrega. Sem um envio real para conferir,
 * a primeira pessoa a descobrir seria alguém que se cadastrou e nunca recebeu
 * o link de confirmação.
 *
 * O erro do provedor volta inteiro. "Falha ao enviar" mandaria o operador
 * adivinhar entre senha errada, porta bloqueada e remetente recusado — que é
 * exatamente o que fizemos dar errado no WhatsApp antes de corrigir.
 */
export async function POST() {
  const user = await requireUser();

  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "EMAIL_SERVER_HOST não configurado. Sem SMTP, ninguém recebe confirmação de cadastro nem recuperação de senha.",
      },
      { status: 400 },
    );
  }

  try {
    await sendTestEmail(user.email, user.name);
    return NextResponse.json({ ok: true, to: user.email });
  } catch (err) {
    captureError(err, { route: "settings.email.test", userId: user.id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao enviar o e-mail de teste." },
      { status: 400 },
    );
  }
}
