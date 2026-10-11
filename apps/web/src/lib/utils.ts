import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency = "BRL", locale = "pt-BR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value));
}

/**
 * Percentual no formato brasileiro: `19,5%`, `+3.262,2%`.
 *
 * Usava `toFixed`, que escreve sempre com ponto — `+3262.2%` ao lado de
 * `R$ 82.677,30` na mesma tela. Para quem lê em português, `19.5%` não é
 * "dezenove e meio": é um número em outro idioma, e o painel inteiro passa a
 * parecer importado e mal ajustado.
 *
 * `comSinal` existe porque variação e nível são coisas diferentes: "+12% vs
 * período anterior" pede o sinal; "margem de 19,5%" não — um "+" ali sugere
 * que a margem subiu, quando ela só é positiva.
 */
export function formatPercent(value: number | string, decimals = 1, comSinal = true): string {
  const n = Number(value);
  const texto = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
  return `${comSinal && n > 0 ? "+" : ""}${texto}%`;
}

/** Múltiplo no formato brasileiro: `9,1x`. É como ROAS se lê. */
export function formatMultiplo(value: number, decimals = 1): string {
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)}x`;
}

export function formatDate(date: Date | string, locale = "pt-BR"): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(date),
  );
}

export function relativeTime(date: Date | string): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}
