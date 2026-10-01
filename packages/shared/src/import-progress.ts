/**
 * A aritmética do progresso de uma importação por janelas.
 *
 * Mora aqui, longe do banco e da rede, porque é a parte que erra calada: um
 * indicador que não se move é indistinguível de um travamento, e essa
 * confusão já custou um dia inteiro de depuração nesta aplicação. Com a
 * conta isolada, ela é verificável por teste em vez de por tentativa.
 */

/** Janela máxima de consulta de pedidos da Shopee: 15 dias por chamada. */
export const JANELA_SEGUNDOS = 15 * 24 * 3600;

export interface EstadoImportacao {
  v: 2;
  /** Início do histórico pedido, em epoch de segundos. */
  ini: number;
  /** Índice da janela atual, contando de zero a partir de `ini`. */
  j: number;
  /** Cursor da Shopee dentro da janela atual. */
  c: string;
}

export function novoEstado(iniEpoch: number): EstadoImportacao {
  return { v: 2, ini: iniEpoch, j: 0, c: "" };
}

export function serializarEstado(estado: EstadoImportacao): string {
  return JSON.stringify(estado);
}

/**
 * Devolve `null` para qualquer coisa que não seja um estado da versão atual —
 * inclusive o cursor do formato antigo (`"epoch|cursor"`), que não guardava o
 * início do histórico e por isso não diz quanto já cobriu. Adivinhar sairia
 * mais caro do que recomeçar: o que já está gravado é pulado sem custo.
 */
export function lerEstado(bruto: string | null | undefined): EstadoImportacao | null {
  if (!bruto) return null;
  try {
    const lido = JSON.parse(bruto) as Partial<EstadoImportacao>;
    if (lido.v !== 2 || typeof lido.ini !== "number" || !Number.isFinite(lido.ini)) return null;
    const j = typeof lido.j === "number" && lido.j >= 0 ? Math.floor(lido.j) : 0;
    return { v: 2, ini: lido.ini, j, c: typeof lido.c === "string" ? lido.c : "" };
  } catch {
    return null;
  }
}

export function totalDeJanelas(ini: number, agoraEpoch: number): number {
  return Math.max(1, Math.ceil((agoraEpoch - ini) / JANELA_SEGUNDOS));
}

/** Fim da janela `j`, nunca além do presente. */
export function fimDaJanela(estado: EstadoImportacao, agoraEpoch: number): number {
  return Math.min(estado.ini + (estado.j + 1) * JANELA_SEGUNDOS, agoraEpoch);
}

/**
 * Percentual concluído.
 *
 * Conta janelas **terminadas**, nunca a que está em andamento, e nunca chega
 * a 100 antes de o trabalho acabar de verdade: uma barra cheia com importação
 * rodando é uma mentira pequena que destrói a confiança no indicador inteiro.
 */
export function percentualConcluido(
  estado: EstadoImportacao,
  agoraEpoch: number,
  concluido: boolean,
): number {
  if (concluido) return 100;
  const janelas = totalDeJanelas(estado.ini, agoraEpoch);
  return Math.max(0, Math.min(99, Math.round((estado.j / janelas) * 100)));
}
