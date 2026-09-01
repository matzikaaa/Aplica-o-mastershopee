/**
 * O texto e as variáveis do relatório diário, num lugar só.
 *
 * Isto vivia dentro do job do worker. Passou a viver aqui quando o envio
 * também passou a poder partir da aplicação web — o worker não está
 * hospedado, e o relatório não pode depender dele para existir.
 *
 * O texto e os parâmetros do template ficam lado a lado de propósito: são
 * duas representações do mesmo dia, e separá-los deixaria o template dizendo
 * um número e o texto de fallback dizendo outro.
 */
export interface DailyReportMetric {
  grossRevenue: unknown;
  netProfit: unknown;
  orderCount: number;
  adSpend: unknown;
}

export function formatBRL(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function marginPercent(metric: DailyReportMetric): number {
  const revenue = Number(metric.grossRevenue);
  return revenue === 0 ? 0 : (Number(metric.netProfit) / revenue) * 100;
}

/** Variáveis do template `mastershopee_daily_report`, na ordem declarada. */
export function dailyReportParams(workspaceName: string, metric: DailyReportMetric): string[] {
  return [
    workspaceName,
    formatBRL(metric.grossRevenue),
    formatBRL(metric.netProfit),
    `${marginPercent(metric).toFixed(2)}%`,
    String(metric.orderCount),
    formatBRL(metric.adSpend),
  ];
}

export function buildDailySummaryMessage(
  workspaceName: string,
  metric: DailyReportMetric,
  /** Rótulo do período — "ontem" no agendado, uma data no envio manual. */
  periodo = "ontem",
): string {
  return [
    `Resultado de ${periodo} em ${workspaceName}:`,
    `💰 Faturamento: ${formatBRL(metric.grossRevenue)}`,
    `💵 Lucro líquido: ${formatBRL(metric.netProfit)}`,
    `📈 Margem: ${marginPercent(metric).toFixed(2)}%`,
    `📦 Pedidos: ${metric.orderCount}`,
    `📢 ADS: ${formatBRL(metric.adSpend)}`,
    `Acesse seu painel para ver os detalhes.`,
  ].join("\n");
}

/** Agora, no fuso do workspace — o relatório é do dia do vendedor, não do UTC. */
export function zonedTime(timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
}
