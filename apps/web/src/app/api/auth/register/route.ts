import { NextResponse } from "next/server";
import { registerSchema } from "@mastershopee/shared";
import { prisma } from "@mastershopee/database";
import { PLAN_ORDER } from "@mastershopee/billing";
import { hashPassword } from "@/lib/password";
import { generateToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/email";
import { getClientIp, isAllowed } from "@/lib/rate-limit";

export async function POST(request: Request) {
  // §38: throttle account creation per IP to slow down mass signup abuse.
  if (!(await isAllowed(`register:ip:${getClientIp(request)}`, 10, 3600))) {
    return NextResponse.json({ error: "Muitas tentativas. Tente novamente mais tarde." }, { status: 429 });
  }

  const body = await request.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, email, password } = parsed.data;
  const requestedPlanCode = typeof body?.planCode === "string" ? body.planCode.toUpperCase() : null;
  const intendedPlanCode = PLAN_ORDER.includes(requestedPlanCode as (typeof PLAN_ORDER)[number]) ? requestedPlanCode : null;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    // Do not reveal whether the account exists — generic message avoids user enumeration (§38).
    return NextResponse.json(
      { message: "Se este e-mail ainda não tem conta, enviamos um link de confirmação." },
      { status: 200 },
    );
  }

  const user = await prisma.user.create({
    data: { name, email: email.toLowerCase(), passwordHash: hashPassword(password), intendedPlanCode },
  });

  const { raw, hash } = generateToken();
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
  });

  const verifyUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/verify-email?token=${raw}`;
  await sendVerificationEmail(user.email, user.name, verifyUrl);

  await prisma.auditLog.create({
    data: { userId: user.id, action: "user.registered", entityType: "User", entityId: user.id },
  });

  return NextResponse.json({ message: "Conta criada. Confira seu e-mail para confirmar o cadastro." });
}
