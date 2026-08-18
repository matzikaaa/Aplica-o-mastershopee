import { NextResponse } from "next/server";
import { resetPasswordSchema } from "@mastershopee/shared";
import { prisma } from "@mastershopee/database";
import { hashPassword } from "@/lib/password";
import { hashToken } from "@/lib/tokens";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Link inválido ou expirado. Solicite um novo." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: hashPassword(parsed.data.password) },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  await prisma.auditLog.create({
    data: { userId: record.userId, action: "user.password_reset", entityType: "User", entityId: record.userId },
  });

  return NextResponse.json({ message: "Senha redefinida com sucesso." });
}
