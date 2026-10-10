import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, recordStockMovement, resolveStockTarget } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

const entrySchema = z.object({
  productId: z.string().min(1),
  units: z.number().int().positive("Informe uma quantidade maior que zero."),
  note: z.string().max(280).optional(),
});

/** §8 — stock entry for a product, scoped to the caller's workspace. */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();

  const parsed = entrySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors[0] ?? "Dados inválidos." }, { status: 400 });
  }

  // Ownership check: never trust a productId from the client without
  // confirming it belongs to this workspace (§8).
  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  // Entrada numa variação agrupada vai para a base, multiplicada.
  //
  // Depois de agrupado, o saldo próprio da variação não é lido por ninguém: as
  // vendas descontam da base, a tela esconde a linha, o alerta não olha. Uma
  // entrada gravada ali sumiria — dez caixas de três recebidas, e o estoque da
  // base parado onde estava. Ler "10" como dez embalagens da variação é o que
  // o SKU quer dizer: LAVANDROLL-3 é um pacote de três.
  const alvo = await resolveStockTarget(product.id);
  const unidades = parsed.data.units * alvo.multiplicador;

  const balance = await recordStockMovement({
    workspaceId: workspace.id,
    productId: alvo.productId,
    type: "PURCHASE_IN",
    units: unidades,
    note:
      alvo.productId === product.id
        ? parsed.data.note
        : [`${parsed.data.units} × ${alvo.multiplicador} recebidos como ${product.name}`, parsed.data.note]
            .filter(Boolean)
            .join(" — "),
    createdByUserId: user.id,
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "stock.entry",
      entityType: "Product",
      entityId: alvo.productId,
      metadata: {
        units: unidades,
        balanceAfter: balance,
        ...(alvo.productId !== product.id ? { recebidoComo: product.id, embalagens: parsed.data.units } : {}),
      },
    },
  });

  return NextResponse.json({
    ok: true,
    balance,
    // A tela precisa saber que a entrada foi parar em outro produto, senão o
    // saldo que ela mostra depois não bate com o que a pessoa digitou.
    ...(alvo.productId !== product.id ? { creditadoNaBase: true, unidades } : {}),
  });
}
