import { describe, expect, it } from "vitest";
import {
  ORDER_IMPORT_FIELDS,
  PRODUCT_IMPORT_FIELDS,
  guessMapping,
  normalizeOrderStatus,
  parseBrDate,
  parseBrNumber,
} from "../import";

describe("parseBrNumber — planilhas brasileiras", () => {
  it("lê o formato brasileiro com milhar e decimal", () => {
    expect(parseBrNumber("1.234,56")).toBe(1234.56);
    expect(parseBrNumber("1.234.567,89")).toBe(1234567.89);
    expect(parseBrNumber("0,50")).toBe(0.5);
  });

  it("lê também o formato de máquina", () => {
    expect(parseBrNumber("12.34")).toBe(12.34);
    expect(parseBrNumber("1234.56")).toBe(1234.56);
    expect(parseBrNumber(1234.56)).toBe(1234.56);
  });

  it("trata ponto seguido de exatamente 3 dígitos como separador de milhar", () => {
    // "1.234" numa exportação brasileira é mil duzentos e trinta e quatro.
    expect(parseBrNumber("1.234")).toBe(1234);
    // Mas "1.5" e "12.34" continuam sendo decimais.
    expect(parseBrNumber("1.5")).toBe(1.5);
    expect(parseBrNumber("12.34")).toBe(12.34);
  });

  it("ignora símbolo de moeda, espaços e percentual", () => {
    expect(parseBrNumber("R$ 1.234,56")).toBe(1234.56);
    expect(parseBrNumber(" 14,5% ")).toBe(14.5);
  });

  it("entende negativo com sinal e com parênteses", () => {
    expect(parseBrNumber("-10,50")).toBe(-10.5);
    expect(parseBrNumber("(10,50)")).toBe(-10.5);
  });

  it("devolve null — nunca zero — para vazio ou texto inválido", () => {
    // Um 0 silencioso aqui viraria um custo errado que parece certo.
    expect(parseBrNumber("")).toBeNull();
    expect(parseBrNumber("   ")).toBeNull();
    expect(parseBrNumber("n/a")).toBeNull();
    expect(parseBrNumber("abc")).toBeNull();
    expect(parseBrNumber(null)).toBeNull();
    expect(parseBrNumber(undefined)).toBeNull();
  });
});

describe("parseBrDate", () => {
  it("lê dd/mm/aaaa", () => {
    const d = parseBrDate("31/12/2026")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it("lê dd/mm/aaaa com hora", () => {
    const d = parseBrDate("05/03/2026 14:30")!;
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it("lê o formato ISO", () => {
    const d = parseBrDate("2026-03-05")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(5);
  });

  it("não confunde dia com mês: 05/03 é 5 de março, não 3 de maio", () => {
    const d = parseBrDate("05/03/2026")!;
    expect(d.getMonth()).toBe(2); // março
    expect(d.getDate()).toBe(5);
  });

  it("devolve null para data inválida ou vazia", () => {
    expect(parseBrDate("")).toBeNull();
    expect(parseBrDate("ontem")).toBeNull();
    expect(parseBrDate(null)).toBeNull();
  });
});

describe("guessMapping", () => {
  it("casa cabeçalhos exatos ignorando acento e caixa", () => {
    const m = guessMapping(["SKU", "Descrição", "Custo Unitário"], PRODUCT_IMPORT_FIELDS);
    expect(m.sku).toBe("SKU");
    expect(m.name).toBe("Descrição");
    expect(m.unitCost).toBe("Custo Unitário");
  });

  it("nunca usa a mesma coluna para dois campos", () => {
    const m = guessMapping(["Código", "Nome", "Custo"], PRODUCT_IMPORT_FIELDS);
    const used = Object.values(m).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it("deixa null o que não conseguiu identificar, em vez de chutar", () => {
    const m = guessMapping(["Coluna A", "Coluna B"], PRODUCT_IMPORT_FIELDS);
    expect(m.sku).toBeNull();
    expect(m.name).toBeNull();
  });

  it("identifica cabeçalhos típicos de exportação de pedidos", () => {
    const m = guessMapping(
      ["ID do pedido", "Data do pedido", "SKU de referência", "Quantidade", "Valor Total", "Comissão"],
      ORDER_IMPORT_FIELDS,
    );
    expect(m.externalOrderId).toBe("ID do pedido");
    expect(m.orderedAt).toBe("Data do pedido");
    expect(m.quantity).toBe("Quantidade");
    expect(m.commissionAmount).toBe("Comissão");
  });
});

describe("normalizeOrderStatus", () => {
  it("reconhece os estados que não contam como venda", () => {
    expect(normalizeOrderStatus("Cancelado")).toBe("CANCELED");
    expect(normalizeOrderStatus("Pedido devolvido")).toBe("RETURNED");
    expect(normalizeOrderStatus("Reembolsado")).toBe("REFUNDED");
  });

  it("reconhece os estados de venda concluída", () => {
    expect(normalizeOrderStatus("Concluído")).toBe("DELIVERED");
    expect(normalizeOrderStatus("Entregue")).toBe("DELIVERED");
    expect(normalizeOrderStatus("Enviado")).toBe("SHIPPED");
  });

  it("assume pago quando o status está vazio ou é desconhecido", () => {
    expect(normalizeOrderStatus("")).toBe("PAID");
    expect(normalizeOrderStatus("qualquer coisa")).toBe("PAID");
  });
});
