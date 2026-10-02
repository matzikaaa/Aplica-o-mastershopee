"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Sparkles } from "lucide-react";
import { sugerirGrupos } from "@mastershopee/shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export interface ProdutoAgrupavel {
  id: string;
  sku: string;
  nome: string;
  unidades: number;
  unitsPerSale: number;
  agrupadoEm: string | null;
}

/**
 * Unifica o estoque de SKUs que são embalagens da mesma mercadoria.
 *
 * A sugestão pelo sufixo do SKU vem pronta porque é ela que torna isto viável:
 * montar o grupo à mão, SKU a SKU com o multiplicador digitado, é trabalho
 * suficiente para a maioria nunca fazer — e aí o estoque continua errado. O
 * palpite preenche tudo, a pessoa confere e confirma.
 *
 * Conferir não é formalidade. Um "-2" pode ser "2 unidades" ou a segunda
 * versão do anúncio, e só quem vende sabe qual; aplicar sozinho estragaria o
 * saldo de um jeito silencioso. Por isso o multiplicador fica editável e nada
 * acontece antes do clique.
 */
export function StockGroupDialog({ produtos }: { produtos: ProdutoAgrupavel[] }) {
  const [open, setOpen] = useState(false);
  const [baseId, setBaseId] = useState("");
  const [membros, setMembros] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const router = useRouter();

  const soltos = useMemo(() => produtos.filter((p) => !p.agrupadoEm), [produtos]);

  const sugestoes = useMemo(() => sugerirGrupos(soltos.map((p) => p.sku)), [soltos]);

  const porSku = useMemo(() => new Map(soltos.map((p) => [p.sku, p])), [soltos]);

  function aplicarSugestao(indice: number) {
    const grupo = sugestoes[indice];
    if (!grupo) return;

    // O membro de menor quantidade vira a base: é nele que a unidade física
    // está expressa, então o multiplicador de todos os outros é um número
    // inteiro e maior que um.
    const [menor, ...resto] = grupo.membros;
    const produtoBase = menor ? porSku.get(menor.sku) : undefined;
    if (!produtoBase) return;

    setBaseId(produtoBase.id);
    const novos: Record<string, number> = {};
    for (const m of resto) {
      const p = porSku.get(m.sku);
      if (p) novos[p.id] = Math.max(1, Math.round(m.unidades / (menor?.unidades ?? 1)));
    }
    setMembros(novos);
    setErro(null);
    setFeito(null);
  }

  function alternar(id: string, unidades: number) {
    setMembros((atual) => {
      const copia = { ...atual };
      if (copia[id] !== undefined) delete copia[id];
      else copia[id] = unidades;
      return copia;
    });
  }

  const base = soltos.find((p) => p.id === baseId);
  const escolhidos = Object.entries(membros);
  const pronto = Boolean(base) && escolhidos.length > 0;

  async function enviar() {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch("/api/stock/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseProductId: baseId,
          membros: escolhidos.map(([productId, unitsPerSale]) => ({ productId, unitsPerSale })),
        }),
      });
      const dados = (await res.json()) as { agrupados?: number; unidadesTransferidas?: number; error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não foi possível agrupar.");

      setFeito(
        `${dados.agrupados} SKU(s) agora descontam de ${base?.sku}` +
          (dados.unidadesTransferidas ? `, com ${dados.unidadesTransferidas} unidades transferidas.` : "."),
      );
      setMembros({});
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível agrupar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <Boxes className="h-4 w-4" />
        Unificar estoque
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Unificar estoque de variações"
        description="Quando o mesmo produto é vendido em embalagens diferentes, o saldo é um só. Escolha a unidade-base e diga quantas unidades cada variação consome."
      >
        <div className="space-y-4">
          {sugestoes.length > 0 && (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                Agrupamentos prováveis pelos seus SKUs
              </p>
              <div className="flex flex-wrap gap-2">
                {sugestoes.map((g, i) => (
                  <button
                    key={g.base}
                    type="button"
                    onClick={() => aplicarSugestao(i)}
                    className="rounded-full border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    {g.base} ({g.membros.length} SKUs)
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Clique para preencher. Confira os números antes de confirmar — nada é aplicado sozinho.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="base">Unidade-base (onde o estoque fica)</Label>
            <select
              id="base"
              value={baseId}
              onChange={(e) => {
                setBaseId(e.target.value);
                setMembros({});
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione…</option>
              {soltos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.nome}
                </option>
              ))}
            </select>
          </div>

          {base && (
            <div className="space-y-2">
              <Label>Variações que consomem {base.sku}</Label>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {soltos
                  .filter((p) => p.id !== base.id)
                  .map((p) => {
                    const marcado = membros[p.id] !== undefined;
                    return (
                      <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
                        <input
                          type="checkbox"
                          id={`m-${p.id}`}
                          checked={marcado}
                          onChange={() => alternar(p.id, 1)}
                          className="h-4 w-4"
                        />
                        <label htmlFor={`m-${p.id}`} className="flex-1 cursor-pointer text-sm">
                          <span className="font-mono text-xs">{p.sku}</span>
                          <span className="ml-2 text-muted-foreground">{p.nome}</span>
                        </label>
                        {marcado && (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={1}
                              max={999}
                              value={membros[p.id]}
                              onChange={(e) =>
                                setMembros((a) => ({ ...a, [p.id]: Math.max(1, Number(e.target.value) || 1) }))
                              }
                              className="h-8 w-16 text-center"
                            />
                            <span className="text-xs text-muted-foreground">un.</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {pronto && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Cada venda de uma variação vai descontar a quantidade indicada de <strong>{base?.sku}</strong>. O saldo
              que as variações têm hoje é transferido para a base, com o ajuste registrado no extrato.
            </p>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}
          {feito && <p className="text-sm text-success">{feito}</p>}

          <Button onClick={enviar} disabled={!pronto || loading} className="w-full">
            {loading ? "Unificando..." : "Unificar estoque"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
