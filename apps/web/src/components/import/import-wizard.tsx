"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { CheckCircle2, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import {
  detectHeaderRow,
  guessMapping,
  type ImportField,
  type ImportSummary,
  type MarketplaceType,
  MARKETPLACE_LABELS,
} from "@mastershopee/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MARKETPLACES: MarketplaceType[] = ["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"];

/**
 * File → column mapping → preview → commit.
 *
 * The mapping step exists because every marketplace names its columns
 * differently; guessing is a convenience, never a decision. Nothing is
 * written until the operator has seen their own data under our field names.
 */
export function ImportWizard({
  fields,
  endpoint,
  needsMarketplace = false,
  title,
  description,
  nextStep,
  option,
}: {
  fields: ImportField[];
  endpoint: string;
  needsMarketplace?: boolean;
  title: string;
  description: string;
  /** Where the operator should go once this import lands. */
  nextStep?: { href: string; label: string };
  /** A single declaration the operator makes about the file, sent with it. */
  option?: { key: string; label: string; hint: string };
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [marketplace, setMarketplace] = useState<MarketplaceType>("SHOPEE");
  const [optionOn, setOptionOn] = useState(false);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /**
   * Turn a raw sheet (array of arrays) into records keyed by column name.
   *
   * Reading the header positionally rather than trusting row 1 is what lets
   * Shopee's ad report work: it opens with seven lines of store metadata
   * before the real header.
   */
  function ingest(matrix: unknown[][], name: string) {
    const headerIndex = detectHeaderRow(matrix);
    const headerRow = matrix[headerIndex] ?? [];

    // Shopee repeats column names in the same file ("Desconto do vendedor"
    // twice, "Cidade" twice). Keyed by name alone, the second silently
    // overwrites the first — so repeats get a suffix and stay distinguishable
    // in the mapping dropdown.
    const seen = new Map<string, number>();
    const cols = headerRow.map((cell, i) => {
      const base = String(cell ?? "").trim() || `Coluna ${i + 1}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return count === 1 ? base : `${base} (${count})`;
    });

    const clean: Record<string, string>[] = [];
    for (const raw of matrix.slice(headerIndex + 1)) {
      const record: Record<string, string> = {};
      let hasValue = false;
      cols.forEach((col, i) => {
        const value = String(raw?.[i] ?? "").trim();
        record[col] = value;
        if (value !== "") hasValue = true;
      });
      if (hasValue) clean.push(record);
    }

    if (clean.length === 0) {
      setParseError(
        "O arquivo tem cabeçalho mas nenhuma linha de dados. Confira o período e o filtro de status na exportação do marketplace.",
      );
      return;
    }

    setHeaders(cols);
    setRows(clean);
    setMapping(guessMapping(cols, fields));
    setFileName(name);
    setSummary(null);
    setParseError(null);
  }

  function handleFile(file: File) {
    setParseError(null);
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: "array", cellDates: true });
          const sheet = wb.Sheets[wb.SheetNames[0]!]!;
          const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
          ingest(matrix, file.name);
        } catch {
          setParseError("Não foi possível ler este arquivo Excel. Tente exportar como CSV.");
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (parsed) => ingest(parsed.data, file.name),
      error: () => setParseError("Não foi possível ler este CSV."),
    });
  }

  const missingRequired = useMemo(
    () => fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label),
    [fields, mapping],
  );

  const preview = useMemo(() => {
    return rows.slice(0, 5).map((row) => {
      const out: Record<string, string> = {};
      for (const field of fields) {
        const col = mapping[field.key];
        out[field.key] = col ? String(row[col] ?? "") : "";
      }
      return out;
    });
  }, [rows, mapping, fields]);

  async function commit() {
    setLoading(true);
    const payload = rows.map((row) => {
      const out: Record<string, string> = {};
      for (const field of fields) {
        const col = mapping[field.key];
        if (col) out[field.key] = String(row[col] ?? "");
      }
      return out;
    });

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: payload,
        ...(needsMarketplace ? { marketplace } : {}),
        ...(option ? { [option.key]: optionOn } : {}),
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setParseError(body?.error ?? "Falha ao importar.");
      return;
    }

    setSummary((await res.json()) as ImportSummary);
    router.refresh();
  }

  function reset() {
    setHeaders([]);
    setRows([]);
    setSummary(null);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  if (summary) {
    return <SummaryView summary={summary} fileName={fileName} onReset={reset} nextStep={nextStep} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>

      {needsMarketplace && (
        <div className="space-y-2">
          <Label>Marketplace de origem</Label>
          <div className="flex flex-wrap gap-2">
            {MARKETPLACES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarketplace(m)}
                aria-pressed={m === marketplace}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition",
                  m === marketplace
                    ? "border-primary bg-primary/5 font-medium text-primary"
                    : "border-border hover:border-primary/50",
                )}
              >
                {MARKETPLACE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      )}

      {headers.length === 0 ? (
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center transition hover:border-primary/50">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Selecione a planilha</p>
            <p className="mt-0.5 text-sm text-muted-foreground">CSV ou Excel (.xlsx) exportado do marketplace</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">· {rows.length} linhas</span>
            </span>
            <Button size="sm" variant="outline" onClick={reset}>
              Trocar arquivo
            </Button>
          </div>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <p className="font-medium">Relacione as colunas</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Preenchemos o que reconhecemos. Confira antes de importar — nada é gravado até você confirmar.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label htmlFor={`map-${field.key}`}>
                      {field.label}
                      {field.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <select
                      id={`map-${field.key}`}
                      value={mapping[field.key] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value || null }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    >
                      <option value="">— não importar —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <p className="text-sm font-medium">Prévia (5 primeiras linhas)</p>
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {fields.map((f) => (
                      <th key={f.key} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {fields.map((f) => (
                        <td key={f.key} className="whitespace-nowrap px-3 py-2">
                          {row[f.key] || <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {missingRequired.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>Relacione as colunas obrigatórias: {missingRequired.join(", ")}.</p>
            </div>
          )}

          {option && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <input
                type="checkbox"
                checked={optionOn}
                onChange={(e) => setOptionOn(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="text-sm">
                <span className="font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          )}

          {parseError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {parseError}
            </p>
          )}

          <Button onClick={commit} disabled={loading || missingRequired.length > 0}>
            {loading ? "Importando..." : `Importar ${rows.length} linhas`}
          </Button>
        </>
      )}

      {parseError && headers.length === 0 && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {parseError}
        </p>
      )}
    </div>
  );
}

function SummaryView({
  summary,
  fileName,
  onReset,
  nextStep,
}: {
  summary: ImportSummary;
  fileName: string;
  onReset: () => void;
  nextStep?: { href: string; label: string };
}) {
  const total = summary.created + summary.updated;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="font-medium">Importação concluída</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {fileName} — {summary.created} criados, {summary.updated} atualizados
            {summary.skipped > 0 && `, ${summary.skipped} ignorados`}.
          </p>
        </div>
      </div>

      {summary.note && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{summary.note}</p>
          {nextStep && (
            <Link href={nextStep.href} className={buttonVariants({ size: "sm", variant: "outline", className: "shrink-0" })}>
              {nextStep.label}
            </Link>
          )}
        </div>
      )}

      {summary.errors.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {summary.errors.length} {summary.errors.length === 1 ? "linha exige atenção" : "linhas exigem atenção"}
          </p>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Linha</th>
                  <th className="px-3 py-2 text-left font-medium">Referência</th>
                  <th className="px-3 py-2 text-left font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {summary.errors.map((e, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{e.row}</td>
                    <td className="px-3 py-2">{e.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Corrija essas linhas na planilha e importe de novo — o que já entrou é atualizado, não duplicado.
          </p>
        </div>
      )}

      {total === 0 && summary.errors.length > 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma linha foi gravada.</p>
      )}

      <Button variant="outline" onClick={onReset}>
        Importar outra planilha
      </Button>
    </div>
  );
}
