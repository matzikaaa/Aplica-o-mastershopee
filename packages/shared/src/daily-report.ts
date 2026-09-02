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

/** O que o vendedor precisa saber sobre estoque, na mesma mensagem. */
export interface StockAlertLine {
  productName: string;
  sku: string;
  quantity: number;
  daysOfCover: number | null;
  isOutOfStock: boolean;
}

/**
 * Resumo de estoque em uma linha, para caber num parâmetro de template.
 *
 * A Meta recusa quebra de linha dentro de parâmetro, então a lista completa
 * fica no corpo da mensagem de texto e aqui vai só o placar. "Tudo certo" é
 * dito explicitamente: silêncio sobre estoque é indistinguível de uma
 * verificação que não rodou.
 */
export function stockSummaryLine(itens: StockAlertLine[]): string {
  if (itens.length === 0) return "Estoque: tudo certo";
  const zerados = itens.filter((i) => i.isOutOfStock).length;
  const partes = [`${itens.length} produto(s) para repor`];
  if (zerados > 0) partes.push(`${zerados} zerado(s)`);
  return `Estoque: ${partes.join(", ")}`;
}

/** Variáveis do template combinado (relatório + estoque), 7 parâmetros. */
export function morningBriefParams(
  workspaceName: string,
  metric: DailyReportMetric,
  itens: StockAlertLine[],
): string[] {
  return [...dailyReportParams(workspaceName, metric), stockSummaryLine(itens)];
}

export function buildDailySummaryMessage(
  workspaceName: string,
  metric: DailyReportMetric,
  /** Rótulo do período — "ontem" no agendado, uma data no envio manual. */
  periodo = "ontem",
  /** Estoque na mesma mensagem: dois avisos pela manhã viram dois ruídos. */
  itens: StockAlertLine[] = [],
): string {
  const linhas = [
    `Resultado de ${periodo} em ${workspaceName}:`,
    `💰 Faturamento: ${formatBRL(metric.grossRevenue)}`,
    `💵 Lucro líquido: ${formatBRL(metric.netProfit)}`,
    `📈 Margem: ${marginPercent(metric).toFixed(2)}%`,
    `📦 Pedidos: ${metric.orderCount}`,
    `📢 ADS: ${formatBRL(metric.adSpend)}`,
  ];

  if (itens.length > 0) {
    linhas.push("", "📉 Repor estoque:");
    // Teto de cinco: a mensagem precisa caber numa tela de celular, e uma
    // lista longa demais deixa de ser lida — o painel tem a lista inteira.
    for (const item of itens.slice(0, 5)) {
      const cobertura = item.isOutOfStock
        ? "ZERADO"
        : item.daysOfCover === null
          ? "sem histórico de venda"
          : `${item.daysOfCover.toFixed(0)} dias de cobertura`;
      linhas.push(`• ${item.sku} — ${item.quantity} un, ${cobertura}`);
    }
    if (itens.length > 5) linhas.push(`• e mais ${itens.length - 5} produto(s)`);
  } else {
    linhas.push("", "📦 Estoque: nenhum produto precisa de reposição.");
  }

  linhas.push("", "Acesse seu painel para ver os detalhes.");
  return linhas.join("\n");
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
