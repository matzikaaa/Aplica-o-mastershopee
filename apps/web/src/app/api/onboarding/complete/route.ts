import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

export async function POST() {
  const { workspace } = await requireWorkspace();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { onboardingCompletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
