import { describe, expect, it } from "vitest";
import { cnpjValido, cpfValido, formatarDocumento, somenteDigitos } from "../documento.js";

describe("CNPJ e CPF da empresa", () => {
  it("aceita CNPJ com dígitos verificadores certos e recusa um errado", () => {
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });

  it("aceita CPF com dígitos verificadores certos e recusa um errado", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });

  it("guarda só dígitos e mostra com máscara", () => {
    expect(somenteDigitos("11.222.333/0001-81")).toBe("11222333000181");
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarDocumento("52998224725")).toBe("529.982.247-25");
  });
});
