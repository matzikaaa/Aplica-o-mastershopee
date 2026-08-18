import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireUser } from "@/lib/session";

export async function POST(request: Request) {
  const user = await requireUser();
  const { name } = await request.json();
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { name: name.trim() } });
  return NextResponse.json({ ok: true });
}
