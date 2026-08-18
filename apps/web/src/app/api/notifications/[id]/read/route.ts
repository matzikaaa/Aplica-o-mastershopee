import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { workspace } = await requireWorkspace();

  // Ownership check (§38): only mark as read if the notification belongs to this workspace.
  const result = await prisma.notification.updateMany({
    where: { id: params.id, workspaceId: workspace.id },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
