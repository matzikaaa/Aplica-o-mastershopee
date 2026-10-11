import { NextResponse } from "next/server";

/** §17 — downloadable CSV template for bulk cost import. */
export async function GET() {
  // ";" e vírgula decimal: é o que o Excel em português abre em colunas e
  // salva de volta. O BOM mantém os acentos do cabeçalho.
  const csv = "\uFEFFSKU;Custo;Embalagem;Imposto;Outros custos\r\nABC123;18,00;1,50;6;0,00\r\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=modelo-custos.csv",
    },
  });
}
