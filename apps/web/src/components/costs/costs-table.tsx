"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseBrNumber, type BulkImportResult } from "@mastershopee/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { AddCostDialog } from "@/components/costs/add-cost-dialog";
import { formatCurrency, formatDateOnly } from "@/lib/utils";

export interface LinhaDeCusto {
  id: string;
  sku: string;
  name: string;
  aliases: string[];
  /** Valores do custo vigente, como texto decimal do banco; null sem custo. */
  unitCost: string | null;
  packagingCost: string | null;
  operationalCost: string | null;
  taxPercent: string | null;
  otherCosts: string | null;
  effectiveFrom: string | null;
}

type Campo = "custo" | "embalagem" | "imposto";
type Rascunho = Record<string, Partial<Record<Campo, string>>>;

const ORIGEM: Record<Campo, keyof LinhaDeCusto> = { custo: "unitCost", embalagem: "packagingCost", imposto: "taxPercent" };

/** "18.5000" do banco → "18,50" no campo; o vendedor digita como lê. */
function paraCampo(v: string | null, casas = 2): string {
  if (v === null) return "";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas, useGrouping: false }).format(
    Number(v),
  );
}

/**
 * A tabela de custos, com modo de edição em lote.
 *
 * Cadastrar custo era um diálogo por produto: com 80 SKUs, 80 diálogos. A
 * planilha resolve para quem já tem os custos numa planilha; para quem tem de
 * cabeça ou numa nota, digitar na própria tabela e salvar tudo de uma vez é o
 * caminho curto. Cada linha salva vira um registro novo de custo (o histórico
 * continua preservado) pela mesma rota da planilha — mesmo reaproveitamento
 * nas vendas já importadas, mesmo recálculo do painel.
 */
export function CostsTable({ produtos }: { produtos: LinhaDeCusto[] }) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho>({});
  const [vigencia, setVigencia] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  const valor = (p: LinhaDeCusto, campo: Campo) =>
    rascunho[p.id]?.[campo] ?? paraCampo(p[ORIGEM[campo]] as string | null);

  const alterados = useMemo(
    () =>
      produtos.filter((p) =>
        (Object.keys(ORIGEM) as Campo[]).some((c) => {
          const novo = rascunho[p.id]?.[c];
          if (novo === undefined) return false;
          const atual = p[ORIGEM[c]] as string | null;
          const n = parseBrNumber(novo);
          return atual === null ? novo.trim() !== "" : n === null || n !== Number(atual);
        }),
      ),
    [produtos, rascunho],
  );

  const idsAlterados = useMemo(() => new Set(alterados.map((p) => p.id)), [alterados]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [produtos, busca]);

  function mudar(id: string, campo: Campo, texto: string) {
    setRascunho((r) => ({ ...r, [id]: { ...r[id], [campo]: texto } }));
  }

  function sair() {
    setEditando(false);
    setRascunho({});
  }

  async function salvar() {
    const erros: string[] = [];
    const rows = alterados.flatMap((p) => {
      const custo = parseBrNumber(valor(p, "custo"));
      const embalagem = parseBrNumber(valor(p, "embalagem") || "0");
      const imposto = parseBrNumber(valor(p, "imposto") || "0");
      if (custo === null || custo < 0) {
        erros.push(`${p.sku}: custo unitário inválido`);
        return [];
      }
      if (embalagem === null || embalagem < 0 || imposto === null || imposto < 0 || imposto > 100) {
        erros.push(`${p.sku}: embalagem ou imposto inválido`);
        return [];
      }
      return [
        {
          sku: p.sku,
          cost: custo,
          packaging: embalagem,
          tax: imposto,
          // Não aparecem na edição em lote: vão como estão, senão o registro
          // novo zeraria o que o vendedor não tocou.
          operationalCost: Number(p.operationalCost ?? 0),
          otherCosts: Number(p.otherCosts ?? 0),
        },
      ];
    });
    if (erros.length > 0) {
      push({ type: "error", title: "Corrija antes de salvar", description: erros.slice(0, 3).join(" · ") });
      return;
    }

    setSalvando(true);
    const res = await fetch("/api/costs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, effectiveFrom: vigencia }),
    });
    const dados = (await res.json().catch(() => ({}))) as Partial<BulkImportResult> & { error?: string };
    setSalvando(false);
    if (!res.ok) {
      push({ type: "error", title: "Não foi possível salvar os custos.", description: dados.error });
      return;
    }
    const salvos = (dados.imported ?? 0) + (dados.updated ?? 0);
    push({
      type: dados.errors?.length ? "error" : "success",
      title: `${salvos} custo(s) salvo(s)`,
      description: dados.errors?.length
        ? dados.errors.map((e) => `${e.sku ?? `linha ${e.row}`}: ${e.message}`).slice(0, 3).join(" · ")
        : `Vigentes a partir de ${formatDateOnly(vigencia)}. O painel já foi recalculado.`,
    });
    sair();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto ou SKU"
          aria-label="Buscar produto ou SKU"
          className="sm:max-w-xs"
        />
        {editando ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="vigencia" className="text-xs text-muted-foreground">
                Vigentes a partir de
              </Label>
              <Input id="vigencia" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className="w-40" />
            </div>
            <Button variant="ghost" onClick={sair} disabled={salvando}>
              Descartar
            </Button>
            <Button onClick={salvar} disabled={salvando || alterados.length === 0}>
              {salvando ? "Salvando..." : `Salvar ${alterados.length} alteraç${alterados.length === 1 ? "ão" : "ões"}`}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setEditando(true)}>
            Editar vários de uma vez
          </Button>
        )}
      </div>

      {editando && (
        <p className="text-xs text-muted-foreground">
          Digite como no papel: 18,50. Cada produto alterado ganha um registro novo de custo; vendas anteriores à data de
          vigência continuam com o custo que valia na época.
        </p>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Custo unitário</TableHead>
              <TableHead>Embalagem</TableHead>
              <TableHead>Imposto</TableHead>
              <TableHead>Vigente desde</TableHead>
              {!editando && <TableHead>Ação</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((p) => {
              const mudou = idsAlterados.has(p.id);
              return (
                <TableRow key={p.id} className={mudou ? "bg-primary/5" : undefined}>
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku}
                      {p.aliases.length > 0 && (
                        <span title="SKUs unificados neste produto"> · também {p.aliases.join(", ")}</span>
                      )}
                    </p>
                  </TableCell>
                  {editando ? (
                    <>
                      {(["custo", "embalagem", "imposto"] as const).map((campo) => (
                        <TableCell key={campo}>
                          <div className="flex items-center gap-1">
                            {campo !== "imposto" && <span className="text-xs text-muted-foreground">R$</span>}
                            <Input
                              inputMode="decimal"
                              value={valor(p, campo)}
                              onChange={(e) => mudar(p.id, campo, e.target.value)}
                              placeholder={campo === "custo" ? "0,00" : "0"}
                              aria-label={`${campo === "custo" ? "Custo unitário" : campo === "embalagem" ? "Embalagem" : "Imposto"} de ${p.name}`}
                              className="h-8 w-24 tabular-nums"
                            />
                            {campo === "imposto" && <span className="text-xs text-muted-foreground">%</span>}
                          </div>
                        </TableCell>
                      ))}
                    </>
                  ) : (
                    <>
                      <TableCell className="tabular-nums">{p.unitCost !== null ? formatCurrency(p.unitCost) : "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {p.packagingCost !== null ? formatCurrency(p.packagingCost) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.taxPercent !== null ? `${paraCampo(p.taxPercent)}%` : "—"}
                      </TableCell>
                    </>
                  )}
                  <TableCell>{p.effectiveFrom ? formatDateOnly(p.effectiveFrom) : "Não cadastrado"}</TableCell>
                  {!editando && (
                    <TableCell>
                      <AddCostDialog productId={p.id} productName={p.name} />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {visiveis.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum produto com &quot;{busca}&quot;.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
