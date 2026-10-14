/**
 * CNPJ e CPF da empresa, para o cabeçalho dos relatórios ao contador, e a
 * chave de acesso das notas fiscais que ela emite.
 *
 * Guardados sem pontuação; a máscara é coisa de exibição. A validação
 * confere os dígitos verificadores: um CNPJ digitado errado no relatório do
 * fechamento é retrabalho para o contador e, pior, dúvida sobre de quem são
 * aqueles números.
 *
 * Desde julho de 2026 a Receita emite CNPJ alfanumérico: as 12 primeiras
 * posições podem ter letras, e só os dois verificadores continuam números.
 * O cálculo é o mesmo módulo 11, com cada caractere valendo o código ASCII
 * menos 48 — para algarismos, o próprio algarismo. Uma validação só de
 * dígitos recusaria a empresa aberta ontem.
 */

export const REGIMES_TRIBUTARIOS = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
} as const;
export type RegimeTributario = keyof typeof REGIMES_TRIBUTARIOS;

export function somenteDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** Sem pontuação e em maiúsculas: "12.abc.345/01de-35" → "12ABC34501DE35". */
export function normalizarDocumento(v: string): string {
  return v.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Valor de cada caractere no módulo 11: ASCII − 48 (0–9 para algarismos, A = 17). */
const valor = (c: string) => c.charCodeAt(0) - 48;

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = base.split("").reduce((acc, c, i) => acc + valor(c) * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const d1 = digitoVerificador(digitos.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(digitos.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digitos[9]) && d2 === Number(digitos[10]);
}

/** CNPJ numérico ou alfanumérico, já normalizado (ver `normalizarDocumento`). */
export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const d1 = digitoVerificador(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** "12345678000195" → "12.345.678/0001-95"; vale para o alfanumérico; CPF com a máscara dele. */
export function formatarDocumento(documento: string): string {
  if (documento.length === 14) {
    return `${documento.slice(0, 2)}.${documento.slice(2, 5)}.${documento.slice(5, 8)}/${documento.slice(8, 12)}-${documento.slice(12)}`;
  }
  if (documento.length === 11) {
    return `${documento.slice(0, 3)}.${documento.slice(3, 6)}.${documento.slice(6, 9)}-${documento.slice(9)}`;
  }
  return documento;
}

/**
 * O que a chave de acesso de uma NF-e diz por si só.
 *
 * São 44 posições: UF (2), ano e mês da emissão (4), CNPJ do emitente (14),
 * modelo (2), série (3), número (9), forma de emissão (1), código numérico
 * (8) e o dígito verificador. Ler número e série daqui, e não de campos
 * soltos, é ler o que a SEFAZ autorizou.
 */
export interface ChaveDeAcesso {
  chave: string;
  uf: string;
  /** "2026-09" */
  anoMes: string;
  cnpjEmitente: string;
  /** 55 é NF-e; 65, NFC-e. */
  modelo: string;
  /** Sem zeros à esquerda: "1", não "001". */
  serie: string;
  /** Sem zeros à esquerda: "1234", não "000001234". */
  numero: string;
}

/** A chave lida e conferida; null se não tem 44 posições ou o verificador não bate. */
export function lerChaveDeAcesso(entrada: string | null | undefined): ChaveDeAcesso | null {
  const chave = normalizarDocumento(entrada ?? "");
  // Só o CNPJ do emitente (posições 7 a 18) pode ter letras.
  if (!/^\d{6}[0-9A-Z]{12}\d{26}$/.test(chave)) return null;

  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += valor(chave[i]!) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  if ((resto < 2 ? 0 : 11 - resto) !== Number(chave[43])) return null;

  const semZeros = (s: string) => s.replace(/^0+(?=\d)/, "");
  return {
    chave,
    uf: chave.slice(0, 2),
    anoMes: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`,
    cnpjEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: semZeros(chave.slice(22, 25)),
    numero: semZeros(chave.slice(25, 34)),
  };
}
