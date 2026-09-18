import { describe, expect, it } from "vitest";
import { costIsUnknown } from "../cost-snapshot";

describe("costIsUnknown — a diferença entre 'de graça' e 'não sabemos'", () => {
  it("nulo é desconhecido", () => {
    expect(costIsUnknown(null)).toBe(true);
    expect(costIsUnknown(undefined)).toBe(true);
  });

  it("zero também é desconhecido, por causa das importações antigas", () => {
    // Gravar zero para "custo ausente" fazia o item sumir do recálculo, que
    // procura por nulo — e o vendedor cadastrava o custo sem nada mudar.
    expect(costIsUnknown(0)).toBe(true);
    expect(costIsUnknown("0")).toBe(true);
    expect(costIsUnknown("0.0000")).toBe(true);
  });

  it("qualquer custo real é conhecido", () => {
    expect(costIsUnknown(18.99)).toBe(false);
    expect(costIsUnknown("0.0100")).toBe(false);
  });

  it("aceita o Decimal do Prisma, que chega como objeto", () => {
    expect(costIsUnknown({ toString: () => "0" })).toBe(true);
    expect(costIsUnknown({ toString: () => "12.55" })).toBe(false);
  });
});
