import { describe, expect, it } from "vitest";
import {
  cnpjValido,
  cpfValido,
  formatarDocumento,
  lerChaveDeAcesso,
  normalizarDocumento,
  somenteDigitos,
} from "../documento.js";

describe("CNPJ e CPF da empresa", () => {
  it("aceita CNPJ com dígitos verificadores certos e recusa um errado", () => {
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });

  it("aceita o CNPJ alfanumérico, com letras nas 12 primeiras posições", () => {
    // Exemplo da Receita: 12.ABC.345/01DE-35.
    expect(cnpjValido("12ABC34501DE35")).toBe(true);
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
    // Letra no verificador não existe.
    expect(cnpjValido("12ABC34501DE3A")).toBe(false);
    expect(normalizarDocumento("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(formatarDocumento("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });

  it("aceita CPF com dígitos verificadores certos e recusa um errado", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });

  it("guarda sem pontuação e mostra com máscara", () => {
    expect(somenteDigitos("11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizarDocumento("11.222.333/0001-81")).toBe("11222333000181");
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarDocumento("52998224725")).toBe("529.982.247-25");
  });
});

describe("chave de acesso da NF-e", () => {
  // UF 35, emitida em 09/2026 pelo CNPJ 11.222.333/0001-81, modelo 55,
  // série 1, número 1234 — verificador calculado à parte.
  const chave = "35260911222333000181550010000012341123456787";

  it("lê número, série, emissão e emitente da própria chave", () => {
    expect(lerChaveDeAcesso(chave)).toEqual({
      chave,
      uf: "35",
      anoMes: "2026-09",
      cnpjEmitente: "11222333000181",
      modelo: "55",
      serie: "1",
      numero: "1234",
    });
  });

  it("aceita a chave com espaços, como vem impressa no DANFE", () => {
    expect(lerChaveDeAcesso("3526 0911 2223 3300 0181 5500 1000 0012 3411 2345 6787")?.numero).toBe("1234");
  });

  it("recusa chave com verificador errado ou tamanho errado", () => {
    expect(lerChaveDeAcesso(chave.slice(0, 43) + "8")).toBeNull();
    expect(lerChaveDeAcesso(chave.slice(1))).toBeNull();
    expect(lerChaveDeAcesso("")).toBeNull();
    expect(lerChaveDeAcesso(null)).toBeNull();
  });

  it("aceita a chave de emitente com CNPJ alfanumérico", () => {
    const alfa = lerChaveDeAcesso("35260912ABC34501DE35550010000012341123456788");
    expect(alfa?.cnpjEmitente).toBe("12ABC34501DE35");
    expect(alfa?.numero).toBe("1234");
    // Letra fora do campo do CNPJ não é chave.
    expect(lerChaveDeAcesso("3A260912ABC34501DE35550010000012341123456788")).toBeNull();
  });
});
