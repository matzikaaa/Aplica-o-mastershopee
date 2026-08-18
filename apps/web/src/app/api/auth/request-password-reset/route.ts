import { NextResponse } from "next/server";
import { requestPasswordResetSchema } from "@mastershopee/shared";
import { prisma } from "@mastershopee/database";
import { generateToken } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/email";

const GENERIC_RESPONSE = { message: "Se este e-mail existir, enviamos um link de redefinição de senha." };

export async function POST(request: Request) {
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

  const resetUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${raw}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  return NextResponse.json(GENERIC_RESPONSE);
}
