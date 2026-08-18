import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/** §50 — notification center. Returns the most recent notifications plus an unread count for the bell badge. */
export async function GET() {
  const { workspace } = await requireWorkspace();

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({ where: { workspaceId: workspace.id, readAt: null } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
