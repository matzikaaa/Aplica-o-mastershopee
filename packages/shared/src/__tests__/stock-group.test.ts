import { describe, expect, it } from "vitest";
import { lerSufixo, sugerirGrupos } from "../stock-group";

describe("leitura do sufixo", () => {
  it("lê a quantidade codificada no SKU", () => {
    expect(lerSufixo("LAVANDROLL-3")).toEqual({ sku: "LAVANDROLL-3", base: "LAVANDROLL", unidades: 3 });
    expect(lerSufixo("MataMofo_2")).toEqual({ sku: "MataMofo_2", base: "MataMofo", unidades: 2 });
    expect(lerSufixo("LimpaBox 10")).toEqual({ sku: "LimpaBox 10", base: "LimpaBox", unidades: 10 });
  });

  it("aceita raiz com números no meio", () => {
    expect(lerSufixo("JIMO3X1-2")).toEqual({ sku: "JIMO3X1-2", base: "JIMO3X1", unidades: 2 });
  });

  it("recusa SKU sem sufixo numérico", () => {
    expect(lerSufixo("LAVANDROLL")).toBeNull();
  });

  it("recusa SKU só de números", () => {
    // "7890" é um código, não "7890 unidades de coisa nenhuma".
    expect(lerSufixo("7890")).toBeNull();
  });

  it("recusa quantidade zero", () => {
    // Multiplicador zero faria a venda não descontar nada — pior que não
    // agrupar, porque parece configurado.
    expect(lerSufixo("KIT-0")).toBeNull();
  });
});

describe("sugestão de grupos", () => {
  it("junta os SKUs que compartilham a raiz, do menor para o maior", () => {
    const [grupo] = sugerirGrupos(["LAVANDROLL-4", "LAVANDROLL-10", "LAVANDROLL-1"]);
    expect(grupo?.base).toBe("LAVANDROLL");
    expect(grupo?.membros.map((m) => m.unidades)).toEqual([1, 4, 10]);
  });

  it("ignora diferença de caixa ao comparar, mas preserva o SKU original", () => {
    const [grupo] = sugerirGrupos(["MataMofo-1", "MATAMOFO-3"]);
    expect(grupo?.membros.map((m) => m.sku)).toEqual(["MataMofo-1", "MATAMOFO-3"]);
  });

  it("não inventa grupo de um SKU só", () => {
    expect(sugerirGrupos(["LAVANDROLL-3", "OUTRACOISA-1"])).toEqual([]);
  });

  it("não mistura raízes diferentes", () => {
    const grupos = sugerirGrupos(["LimpaBox-1", "LimpaBox-2", "LimpaVidro-1", "LimpaVidro-2"]);
    expect(grupos.map((g) => g.base)).toEqual(["LimpaBox", "LimpaVidro"]);
  });
});
