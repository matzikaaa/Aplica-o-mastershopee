import type { DateRange, DateRangePreset } from "./types";

/**
 * Dias no fuso do workspace (§63), não no do servidor.
 *
 * O servidor da Vercel roda em UTC, e os cortes de dia eram feitos nele: no
 * Brasil, o dia virava às 21h. Uma venda às 22h30 entrava no dia seguinte —
 * no painel, no "Hoje", no resumo de "ontem" e na data da lista de pedidos —
 * e o número do app não batia com o da Central do Vendedor justamente no
 * horário em que mais se vende.
 *
 * Duas representações, cada uma no seu lugar:
 * - instantes reais (`from`/`to`) para filtrar pedidos por `orderedAt`;
 * - chaves "AAAA-MM-DD" para colunas de data sem hora (métricas diárias),
 *   que guardam o dia do calendário do vendedor.
 *
 * Intl em vez de biblioteca de datas, para manter o pacote leve.
 */

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function partes(instante: Date, timezone: string): Partes {
  let f = formatadores.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // h23: alguns ambientes escrevem a meia-noite como "24" com hour12:false.
      hourCycle: "h23",
    });
    formatadores.set(timezone, f);
  }
  const ps = f.formatToParts(instante);
  const n = (tipo: string) => Number(ps.find((p) => p.type === tipo)?.value ?? "0");
  return { ano: n("year"), mes: n("month"), dia: n("day"), hora: n("hour"), minuto: n("minute"), segundo: n("second") };
}

const doisDigitos = (v: number) => String(v).padStart(2, "0");

/** O dia do calendário, "AAAA-MM-DD", em que o instante cai no fuso dado. */
export function chaveDoDia(instante: Date, timezone: string): string {
  const p = partes(instante, timezone);
  return `${p.ano}-${doisDigitos(p.mes)}-${doisDigitos(p.dia)}`;
}

/** Quanto o fuso está à frente do UTC naquele instante, em milissegundos. */
function deslocamento(instante: Date, timezone: string): number {
  const p = partes(instante, timezone);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** "AAAA-MM-DD" somado de `dias` dias de calendário. */
export function somarDias(chave: string, dias: number): string {
  const [a, m, d] = chave.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** O instante real de um horário de parede (mês de 1 a 12) no fuso dado. */
export function instanteNoFuso(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  segundo: number,
  timezone: string,
): Date {
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  // Segundo ajuste: o deslocamento certo é o do horário local, que pode
  // diferir do da leitura em UTC em fusos com horário de verão.
  let t = comoUtc - deslocamento(new Date(comoUtc), timezone);
  t = comoUtc - deslocamento(new Date(t), timezone);
  return new Date(t);
}

/**
 * Reinterpreta no fuso dado um Date montado com o construtor local — o que
 * `parseBrDate` devolve para "11/10/2026 22:30". O relatório da Shopee traz
 * o horário de Brasília; lido no fuso do servidor (UTC), a venda ficava 3h
 * deslocada e a da madrugada caía no dia anterior.
 */
export function horarioDeParedeNoFuso(lido: Date, timezone: string): Date {
  return instanteNoFuso(
    lido.getFullYear(),
    lido.getMonth() + 1,
    lido.getDate(),
    lido.getHours(),
    lido.getMinutes(),
    lido.getSeconds(),
    timezone,
  );
}

/** O instante da meia-noite local de um dia. */
export function inicioDoDia(chave: string, timezone: string): Date {
  const [a, m, d] = chave.split("-").map(Number) as [number, number, number];
  return instanteNoFuso(a, m, d, 0, 0, 0, timezone);
}

/** O último instante (23:59:59,999) de um dia local. */
export function fimDoDia(chave: string, timezone: string): Date {
  return new Date(inicioDoDia(somarDias(chave, 1), timezone).getTime() - 1);
}

/**
 * O dia como é gravado numa coluna de data sem hora: meia-noite UTC daquele
 * dia de calendário. É o valor a usar em `where` e `data` de colunas `@db.Date`.
 */
export function dataDoDia(chave: string): Date {
  return new Date(`${chave}T00:00:00.000Z`);
}

/** Filtro de Prisma para uma coluna de data sem hora dentro do período. */
export function diasDoPeriodo(range: DateRange): { gte: Date; lte: Date } {
  return { gte: dataDoDia(range.fromKey), lte: dataDoDia(range.toKey) };
}

export function periodo(fromKey: string, toKey: string, timezone: string): DateRange {
  return { from: inicioDoDia(fromKey, timezone), to: fimDoDia(toKey, timezone), fromKey, toKey, timezone };
}

const INICIO_DE_TUDO = "2000-01-01";

/** Resolve um período pré-definido no fuso do workspace (§10, §63). */
export function resolveDateRange(preset: DateRangePreset, timezone: string, now = new Date()): DateRange {
  const hoje = chaveDoDia(now, timezone);

  switch (preset) {
    case "yesterday": {
      const ontem = somarDias(hoje, -1);
      return periodo(ontem, ontem, timezone);
    }
    case "last_7_days":
      return periodo(somarDias(hoje, -6), hoje, timezone);
    case "last_30_days":
      return periodo(somarDias(hoje, -29), hoje, timezone);
    case "this_month":
      return periodo(`${hoje.slice(0, 8)}01`, hoje, timezone);
    case "last_month": {
      const primeiroDesteMes = `${hoje.slice(0, 8)}01`;
      const ultimoDoAnterior = somarDias(primeiroDesteMes, -1);
      return periodo(`${ultimoDoAnterior.slice(0, 8)}01`, ultimoDoAnterior, timezone);
    }
    case "all_time":
      // Piso fixo em vez de "o pedido mais antigo": esta função é pura, sem
      // acesso a dados, e o histórico de um vendedor não é anterior aos
      // marketplaces.
      return periodo(INICIO_DE_TUDO, hoje, timezone);
    case "today":
    case "custom":
    default:
      return periodo(hoje, hoje, timezone);
  }
}

/**
 * O período imediatamente anterior, do mesmo número de dias, para as
 * comparações (§48). Null para um período que vai até o começo: não existe
 * nada antes de "tudo", e comparar contra o vazio daria um +100% inventado.
 */
export function previousPeriod(range: DateRange): DateRange | null {
  if (range.fromKey <= INICIO_DE_TUDO) return null;
  const dias =
    Math.round((dataDoDia(range.toKey).getTime() - dataDoDia(range.fromKey).getTime()) / 86_400_000) + 1;
  return periodo(somarDias(range.fromKey, -dias), somarDias(range.fromKey, -1), range.timezone);
}
