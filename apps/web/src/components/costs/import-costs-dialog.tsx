"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Upload, Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { BulkImportResult } from "@mastershopee/shared";

export function ImportCostsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const router = useRouter();

  function handleFile(file: File) {
    setLoading(true);
    setResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        const rows = (parsed.data as Record<string, string>[]).map((r) => ({
          sku: r.SKU ?? r.sku,
          cost: Number(r.Custo ?? r.cost),
          packaging: Number(r.Embalagem ?? r.packaging ?? 0),
          tax: Number(r.Imposto ?? r.tax ?? 0),
          otherCosts: Number(r["Outros custos"] ?? r.otherCosts ?? 0),
        }));

        const res = await fetch("/api/costs/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        const data = (await res.json()) as BulkImportResult;
        setResult(data);
        setLoading(false);
        router.refresh();
      },
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Upload className="h-4 w-4" /> Importar em massa
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Importar custos em massa" description="Envie um CSV com as colunas SKU, Custo, Embalagem, Imposto, Outros custos.">
        <div className="space-y-4">
          <a href="/api/costs/template" className="flex items-center gap-2 text-sm text-primary hover:underline">
            <Download className="h-4 w-4" /> Baixar modelo CSV
          </a>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
          />
          {loading && <p className="text-sm text-muted-foreground">Processando...</p>}
          {result && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p>✅ Importados: {result.imported}</p>
              <p>🔄 Atualizados: {result.updated}</p>
              <p>⏭️ Ignorados: {result.skipped}</p>
              {result.errors.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto text-xs text-destructive">
                  {result.errors.map((e, i) => (
                    <p key={i}>
                      Linha {e.row} {e.sku ? `(${e.sku})` : ""}: {e.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
