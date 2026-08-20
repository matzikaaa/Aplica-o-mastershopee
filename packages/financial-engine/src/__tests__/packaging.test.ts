import { describe, expect, it } from "vitest";
import { calculatePackagingCost } from "../packaging";

describe("calculatePackagingCost", () => {
  it("divide o preço do pacote pelas unidades que vêm nele", () => {
    // Rolo de 100 sacos por R$ 50,00 => R$ 0,50 por saco.
    const r = calculatePackagingCost([{ name: "Saco plástico", packPrice: "50.00", unitsPerPack: 100 }]);

    expect(r.lines[0]!.costPerUnit.toFixed(4)).toBe("0.5000");
    expect(r.totalPerShipment.toFixed(4)).toBe("0.5000");
  });

  it("soma vários componentes de uma embalagem", () => {
    const r = calculatePackagingCost([
      { name: "Caixa", packPrice: "120.00", unitsPerPack: 50 }, // 2,40
      { name: "Fita", packPrice: "18.00", unitsPerPack: 60 }, //  0,30
      { name: "Etiqueta", packPrice: "25.00", unitsPerPack: 500 }, // 0,05
    ]);

    expect(r.totalPerShipment.toFixed(4)).toBe("2.7500");
    expect(r.lines).toHaveLength(3);
  });

  it("multiplica pela quantidade usada quando um envio consome mais de uma unidade", () => {
    // Dois sacos por envio a R$ 0,50 cada.
    const r = calculatePackagingCost([
      { name: "Saco plástico", packPrice: "50.00", unitsPerPack: 100, unitsUsed: 2 },
    ]);

    expect(r.lines[0]!.subtotal.toFixed(4)).toBe("1.0000");
    expect(r.totalPerShipment.toFixed(4)).toBe("1.0000");
  });

  it("mantém a precisão em divisões que não fecham redondo", () => {
    // R$ 10,00 / 3 = 3,3333... — nunca arredonda para float pelo caminho.
    const r = calculatePackagingCost([{ name: "Item", packPrice: "10.00", unitsPerPack: 3, unitsUsed: 3 }]);

    expect(r.totalPerShipment.toFixed(4)).toBe("10.0000");
  });

  it("recusa pacote com zero unidades em vez de dividir por zero", () => {
    expect(() => calculatePackagingCost([{ name: "Caixa", packPrice: "10.00", unitsPerPack: 0 }])).toThrow(
      /unidades vêm no pacote/,
    );
  });

  it("recusa quantidade usada negativa", () => {
    expect(() =>
      calculatePackagingCost([{ name: "Caixa", packPrice: "10.00", unitsPerPack: 10, unitsUsed: -1 }]),
    ).toThrow(/não pode ser negativa/);
  });

  it("retorna zero para uma embalagem sem componentes", () => {
    const r = calculatePackagingCost([]);
    expect(r.totalPerShipment.toFixed(4)).toBe("0.0000");
    expect(r.lines).toHaveLength(0);
  });
});
