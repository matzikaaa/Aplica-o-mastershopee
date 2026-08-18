import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import Decimal from "decimal.js";
import { prisma } from "@mastershopee/database";
import { resolveDateRange, type DateRangePreset } from "@mastershopee/shared";
import { financialEngine } from "@mastershopee/financial-engine";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";

/** §26 — pedidos report export (CSV or XLSX via ?format=). Advanced-report gate reuses the centralized plan service (§28). */
export async function GET(request: Request) {
  const { workspace } = await requireWorkspace();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const period = (url.searchParams.get("period") ?? "last_30_days") as DateRangePreset;
  const range = resolveDateRange(period, workspace.timezone);

  const permissions = await getPlanPermissionService(workspace.id);
  if (format === "xlsx" && !permissions.canUseAdvancedReports().allowed) {
    return NextResponse.json({ error: "Exportação XLSX requer o plano Pro." }, { status: 403 });
  }

  const orders = await prisma.order.findMany({
    where: { workspaceId: workspace.id, orderedAt: { gte: range.from, lte: range.to } },
    include: { items: true },
    orderBy: { orderedAt: "desc" },
  });

  const rows = orders.map((order) => {
    const result = financialEngine.calculateOrder({
      grossAmount: order.grossAmount,
      commissionAmount: order.commissionAmount,
      marketplaceFeeAmount: order.marketplaceFeeAmount,
      shippingSubsidizedByMerchant: order.shippingSubsidizedByMerchant,
      taxAmount: order.taxAmount,
      adSpendAttributed: order.adSpendAttributed,
      items: order.items.map((i) => ({ quantity: i.quantity, unitCost: i.unitCostSnapshot ?? new Decimal(0) })),
    });
    return {
      Pedido: order.externalOrderId,
      Data: order.orderedAt.toISOString().slice(0, 10),
      Marketplace: order.marketplace,
      Status: order.status,
      Faturamento: order.grossAmount.toString(),
      Comissao: order.commissionAmount.toString(),
      Taxas: order.marketplaceFeeAmount.toString(),
      ADS: order.adSpendAttributed.toString(),
      LucroLiquido: result.netProfit.toFixed(2),
      MargemPercent: result.marginPercent.toFixed(2),
    };
  });

  if (format === "xlsx") {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Pedidos");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=pedidos.xlsx",
      },
    });
  }

  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=pedidos.csv" },
  });
}
