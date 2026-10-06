"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Pede uma sincronização quando o painel é aberto.
 *
 * Não desenha nada: a automação boa é a que não se anuncia. O vendedor abre o
 * painel e os números estão certos, sem botão de "atualizar" para ele lembrar
 * de apertar — e um botão desses é, na prática, a aplicação pedindo que o
 * usuário faça o trabalho dela.
 *
 * O Cron da Vercel no plano gratuito roda uma vez por dia, o que cobre o
 * relatório da manhã e não cobre quem abre a tela à tarde. Quem está olhando é
 * o melhor gatilho disponível sem infraestrutura paga.
 *
 * Toda a decisão fica no servidor: ele é que sabe quando foi a última vez e se
 * há importação pela metade. Aqui só se bate na porta — e quando a resposta
 * diz que algo entrou, a tela se refaz para mostrar.
 */
export function AutoSync() {
  const router = useRouter();
  const jaPediu = useRef(false);

  useEffect(() => {
    // Uma vez por montagem: o StrictMode do React monta duas vezes em
    // desenvolvimento, e sem esta trava seriam duas sincronizações a cada
    // abertura de tela.
    if (jaPediu.current) return;
    jaPediu.current = true;

    const controle = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/integrations/shopee/auto", {
          method: "POST",
          signal: controle.signal,
        });
        if (!res.ok) return;
        const dados = (await res.json()) as { gravados?: number };
        if (dados.gravados && dados.gravados > 0) router.refresh();
      } catch {
        // Silêncio de propósito. Isto é trabalho de fundo que ninguém pediu;
        // falhar aqui não pode encher a tela de aviso. O estado real da
        // conexão aparece em Integrações, que é onde se age sobre ele.
      }
    })();

    return () => controle.abort();
  }, [router]);

  return null;
}
