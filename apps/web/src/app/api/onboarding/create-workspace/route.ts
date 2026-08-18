import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireUser } from "@/lib/session";

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** §4 — creates the workspace + a 14-day trial subscription (no payment step needed for the trial, §28). */
export async function POST(request: Request) {
  const user = await requireUser();
  const { companyName, planCode } = await request.json();

  if (!companyName || typeof companyName !== "string" || companyName.trim().length < 2) {
    return NextResponse.json({ error: "Informe o nome da empresa." }, { status: 400 });
  }

  const plan = await prisma.plan.findUnique({ where: { code: planCode ?? "PRO" } });
  if (!plan) {
    return NextResponse.json({ error: "Plano inválido." }, { status: 400 });
  }

  const baseSlug = slugify(companyName) || "empresa";
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++suffix}`;
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: companyName.trim(),
      slug,
      members: { create: { userId: user.id, role: "OWNER", joinedAt: new Date() } },
      subscription: {
        create: {
          planId: plan.id,
          status: "trialing",
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: { workspaceId: workspace.id, userId: user.id, action: "workspace.created", entityId: workspace.id },
  });

  return NextResponse.json({ ok: true, slug: workspace.slug });
}
