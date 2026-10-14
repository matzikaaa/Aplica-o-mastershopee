/**
 * CNPJ e CPF da empresa, para o cabeçalho dos relatórios ao contador.
 *
 * Guardados só com dígitos; a máscara é coisa de exibição. A validação
 * confere os dígitos verificadores: um CNPJ digitado errado no relatório do
 * fechamento é retrabalho para o contador e, pior, dúvida sobre de quem são
 * aqueles números.
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

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const d1 = digitoVerificador(digitos.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(digitos.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digitos[9]) && d2 === Number(digitos[10]);
}

export function cnpjValido(digitos: string): boolean {
  if (!/^\d{14}$/.test(digitos) || /^(\d)\1{13}$/.test(digitos)) return false;
  const d1 = digitoVerificador(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificador(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digitos[12]) && d2 === Number(digitos[13]);
}

/** "12345678000195" → "12.345.678/0001-95"; CPF com a máscara dele. */
export function formatarDocumento(digitos: string): string {
  if (digitos.length === 14) return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (digitos.length === 11) return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return digitos;
}
