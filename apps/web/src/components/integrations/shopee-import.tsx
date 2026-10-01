"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A importação do histórico, conduzida pela própria tela.
 *
 * O desenho anterior era um botão que tentava trazer tudo numa requisição só
 * e devolvia 504 quando não cabia. Aqui o trabalho vive no servidor, fatiado;
 * a tela só pede o próximo pedaço e mostra onde está. Fechar a aba não
 * cancela nada, e reabrir reencontra o trabalho de onde parou — é por isso
 * que ela consulta o progresso ao montar antes de qualquer outra coisa.
 */

interface Progresso {
  status: "RUNNING" | "COMPLETED" | "FAILED" | "QUEUED" | "PARTIAL";
  janela: number;
  janelas: number;
  percentual: number;
  pedidosGravados: number;
  desde: string;
  ate: string | null;
  erro: string | null;
  concluido: boolean;
}

const dia = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

export function ShopeeImport() {
  const router = useRouter();
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [rodando, setRodando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  // Um sinal de parada que sobrevive às re-renderizações: sem ele, sair da
  // página deixaria o laço pedindo pedaços para sempre.
  const ativo = useRef(false);
  useEffect(() => () => void (ativo.current = false), []);

  const pedir = useCallback(async (url: string, corpo?: unknown) => {
    const res = await fetch(url, {
      method: corpo === undefined ? "GET" : "POST",
      ...(corpo === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
    });
    const texto = await res.text();
    let dados: Record<string, unknown>;
    try {
      dados = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      // A plataforma responde HTML quando mata a função. Traduzir aqui evita
      // que a tela mostre uma página de erro inteira dentro de um aviso.
      throw new Error(
        res.status === 504
          ? "O servidor demorou demais nesta rodada. O progresso foi guardado — pode continuar."
          : `Resposta inesperada do servidor (${res.status}).`,
      );
    }
    if (!res.ok) throw new Error(String(dados.error ?? "Falha na importação."));
    return dados;
  }, []);

  // Retoma a exibição de um trabalho que já existia — inclusive de outra aba
  // ou de antes de recarregar.
  useEffect(() => {
    void (async () => {
      try {
        const dados = await pedir("/api/integrations/shopee/import/progress");
        if (!dados.nenhuma) setProgresso(dados as unknown as Progresso);
      } catch {
        // Sem trabalho aberto não é erro: é o estado inicial.
      }
    })();
  }, [pedir]);

  const laco = useCallback(async () => {
    while (ativo.current) {
      const atual = (await pedir("/api/integrations/shopee/import/tick", {})) as unknown as Progresso;
      setProgresso(atual);

      if (atual.erro) throw new Error(atual.erro);
      if (atual.concluido) return;
    }
  }, [pedir]);

  async function importar() {
    setFalha(null);
    setRodando(true);
    ativo.current = true;
    try {
      setProgresso((await pedir("/api/integrations/shopee/import/start", { dias: 120 })) as unknown as Progresso);
      await laco();
      router.refresh();
    } catch (err) {
      setFalha(err instanceof Error ? err.message : "Falha na importação.");
    } finally {
      ativo.current = false;
      setRodando(false);
    }
  }

  function parar() {
    // Só interrompe o laço da tela. O trabalho fica guardado no servidor e
    // continua do mesmo ponto quando for retomado — nada se perde.
    ativo.current = false;
  }

  const p = progresso;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Importar histórico da Shopee</p>
          <p className="text-sm text-muted-foreground">
            Traz os pedidos dos últimos 120 dias. Pode fechar a página: o trabalho continua guardado e retoma de
            onde parou.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {rodando ? (
            <Button variant="outline" onClick={parar}>
              Pausar
            </Button>
          ) : (
            <Button onClick={importar}>
              <Download className="mr-2 h-4 w-4" />
              {p && !p.concluido ? "Continuar" : "Importar histórico"}
            </Button>
          )}
        </div>
      </div>

      {p && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${p.percentual}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {p.concluido ? (
              <span className="flex items-center gap-1.5 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                Histórico completo
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                {rodando && <Loader2 className="h-4 w-4 animate-spin" />}
                Período {p.janela} de {p.janelas} — até {dia(p.ate)}
              </span>
            )}
            {/* Pedidos gravados aparece sempre: dentro de um período longo a
                fração de períodos não se move, e um indicador parado já custou
                caro demais aqui. */}
            <span className="tabular-nums">{p.pedidosGravados.toLocaleString("pt-BR")} pedidos gravados</span>
          </div>
        </div>
      )}

      {falha && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {falha} <span className="font-medium">Clique em Continuar — nada do que já entrou se perde.</span>
          </span>
        </p>
      )}
    </div>
  );
}
