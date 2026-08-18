import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

export async function POST() {
  const { workspace } = await requireWorkspace();
  await prisma.notification.updateMany({
    where: { workspaceId: workspace.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
