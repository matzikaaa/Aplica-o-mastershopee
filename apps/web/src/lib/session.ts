import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@mastershopee/database";
import { authOptions } from "./auth";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Resolves the workspace for the current request and verifies the current
 * user is actually a member — this is the multi-tenant isolation
 * boundary (§8): every server component / route handler that reads
 * workspace-scoped data must go through this instead of trusting an id
 * from the URL or client.
 */
export async function requireWorkspace(workspaceSlug?: string) {
  const user = await requireUser();

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      userId: user.id,
      ...(workspaceSlug ? { workspace: { slug: workspaceSlug } } : {}),
    },
    include: { workspace: { include: { subscription: { include: { plan: true } } } } },
    orderBy: { joinedAt: "asc" },
  });

  if (!membership) redirect("/onboarding");

  return { user, workspace: membership.workspace, role: membership.role };
}
