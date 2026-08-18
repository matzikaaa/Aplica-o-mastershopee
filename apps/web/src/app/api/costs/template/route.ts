import { NextResponse } from "next/server";

/** §17 — downloadable CSV template for bulk cost import. */
export async function GET() {
  const csv = "SKU,Custo,Embalagem,Imposto,Outros custos\nABC123,18.00,1.50,6,0.00\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=modelo-custos.csv",
    },
  });
}
