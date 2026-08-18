import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { alertRuleSchema } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";

export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const gate = permissions.canUseAdvancedAlerts();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 403 });
  }

  const body = await request.json();
  const parsed = alertRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rule = await prisma.alertRule.create({
    data: { workspaceId: workspace.id, ...parsed.data },
  });

  await prisma.auditLog.create({
    data: { workspaceId: workspace.id, userId: user.id, action: "alert_rule.created", entityId: rule.id },
  });

  return NextResponse.json(rule);
}
