"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Rodada {
  consultados: number;
  encontradas: number;
  faltam: number;
  cursor: string;
  erro: string | null;
}

/**
 * Busca na Shopee a nota fiscal dos pedidos do mês que estão sem ela.
 *
 * Cada chamada ao servidor anda o que cabe em uns vinte segundos e devolve
 * de onde continuar; o botão repete até acabar e então recarrega o
 * documento, que passa a mostrar as notas.
 */
export function BuscarNotasButton({ mes }: { mes: string }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function buscar() {
    setRodando(true);
    setMensagem("Consultando a Shopee…");
    let cursor = "";
    let consultados = 0;
    let encontradas = 0;
    let erro: string | null = null;

    // Teto de rodadas só para nunca girar para sempre; um mês cabe em poucas.
    for (let rodada = 0; rodada < 100; rodada++) {
      let r: (Rodada & { error?: string }) | null = null;
      try {
        const res = await fetch("/api/reports/fechamento/notas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mes, cursor }),
        });
        r = (await res.json().catch(() => null)) as (Rodada & { error?: string }) | null;
        if (!res.ok || !r) {
          erro = r?.error ?? "A Shopee não respondeu agora. Tente de novo em alguns minutos.";
          break;
        }
      } catch {
        erro = "Sem conexão com o servidor. Tente de novo.";
        break;
      }

      consultados += r.consultados;
      encontradas += r.encontradas;
      cursor = r.cursor;
      setMensagem(`Consultados ${consultados} pedidos · ${encontradas} com nota${r.faltam > 0 ? ` · faltam ${r.faltam}` : ""}`);
      if (r.erro) {
        erro = r.erro;
        break;
      }
      if (r.faltam === 0 || r.consultados === 0) break;
    }

    setRodando(false);
    setMensagem(
      erro
        ? `Parou no meio: ${erro}`
        : encontradas > 0
          ? `${encontradas} nota(s) encontrada(s) em ${consultados} pedidos.`
          : `Nenhuma nota vinculada na Shopee aos ${consultados} pedidos consultados.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={buscar} disabled={rodando} className="gap-2">
        <FileSearch className="h-4 w-4" />
        {rodando ? "Buscando notas…" : "Buscar notas na Shopee"}
      </Button>
      {mensagem && (
        <span className="text-sm text-muted-foreground" role="status">
          {mensagem}
        </span>
      )}
    </div>
  );
}
