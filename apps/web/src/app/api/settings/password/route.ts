import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireUser } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  const user = await requireUser();
  const { currentPassword, newPassword } = await request.json();

  if (!verifyPassword(currentPassword ?? "", user.passwordHash)) {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "A nova senha deve ter ao menos 8 caracteres." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "user.password_changed" } });

  return NextResponse.json({ ok: true });
}
