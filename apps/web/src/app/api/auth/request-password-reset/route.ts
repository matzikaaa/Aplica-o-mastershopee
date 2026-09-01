import { NextResponse } from "next/server";
import { requestPasswordResetSchema } from "@mastershopee/shared";
import { prisma } from "@mastershopee/database";
import { generateToken } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { captureError } from "@/lib/observability";
import { getClientIp, isAllowed } from "@/lib/rate-limit";

const GENERIC_RESPONSE = { message: "Se este e-mail existir, enviamos um link de redefinição de senha." };

export async function POST(request: Request) {
  // §38: throttle per IP so this can't be used to mass-spam arbitrary inboxes.
  if (!(await isAllowed(`password-reset:ip:${getClientIp(request)}`, 10, 3600))) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente mais tarde." }, { status: 429 });
  }

  const body = await request.json();
  const parsed = requestPasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  // Always return the same response whether or not the account exists (§38 — avoid user enumeration).
  if (!user) return NextResponse.json(GENERIC_RESPONSE);

  const { raw, hash } = generateToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 3600 * 1000) },
  });

  const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${raw}`;

  try {
    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (err) {
    // A resposta continua genérica mesmo aqui: distinguir "falhou o envio" de
    // "e-mail não cadastrado" entrega ao atacante a lista de quem tem conta.
    // O erro vai para o log, que é onde o operador precisa vê-lo.
    captureError(err, { route: "auth.request-password-reset" });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
