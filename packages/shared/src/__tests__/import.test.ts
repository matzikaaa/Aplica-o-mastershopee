import { describe, expect, it } from "vitest";
import {
  ORDER_IMPORT_FIELDS,
  ADS_IMPORT_FIELDS,
  SKU_DISCOVERY_FIELDS,
  collectDiscoveredSkus,
  detectHeaderRow,
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

describe("collectDiscoveredSkus — catálogo a partir do relatório", () => {
  it("colapsa um relatório de vendas em SKUs distintos", () => {
    const { skus } = collectDiscoveredSkus([
      { sku: "SAC-100", name: "Saco de lixo 100L" },
      { sku: "SAC-100", name: "Saco de lixo 100L" },
      { sku: "COP-50", name: "Copo 50ml" },
      { sku: "SAC-100", name: "Saco de lixo 100L" },
    ]);

    expect(skus.map((s) => s.sku)).toEqual(["SAC-100", "COP-50"]);
    expect(skus[0]!.row).toBe(2);
    expect(skus[1]!.row).toBe(4);
  });

  it("aproveita o primeiro nome preenchido quando o relatório o omite em algumas linhas", () => {
    const { skus } = collectDiscoveredSkus([
      { sku: "SAC-100", name: "  " },
      { sku: "SAC-100", name: "Saco de lixo 100L" },
      { sku: "SAC-100", name: "Saco de lixo 100 litros" },
    ]);

    expect(skus).toHaveLength(1);
    expect(skus[0]!.name).toBe("Saco de lixo 100L");
  });

  it("devolve nome nulo quando nenhuma linha traz nome, sem inventar um", () => {
    const { skus } = collectDiscoveredSkus([{ sku: "COP-50" }]);
    expect(skus[0]!.name).toBeNull();
  });

  it("aponta as linhas sem SKU em vez de descartá-las em silêncio", () => {
    const { skus, blankRows } = collectDiscoveredSkus([
      { sku: "COP-50" },
      { sku: "   " },
      { name: "linha de total" },
    ]);

    expect(skus).toHaveLength(1);
    expect(blankRows).toEqual([3, 4]);
  });

  it("trata espaços em volta do SKU como o mesmo produto", () => {
    const { skus } = collectDiscoveredSkus([{ sku: " COP-50 " }, { sku: "COP-50" }]);
    expect(skus).toHaveLength(1);
    expect(skus[0]!.sku).toBe("COP-50");
  });

  it("reconhece as colunas de SKU e nome de uma exportação de pedidos", () => {
    const mapping = guessMapping(["Nº do pedido", "SKU do produto", "Nome do produto", "Quantidade"], SKU_DISCOVERY_FIELDS);
    expect(mapping.sku).toBe("SKU do produto");
    expect(mapping.name).toBe("Nome do produto");
  });
});

// Cabeçalhos copiados de exportações reais da Shopee (agosto/2026).
const SHOPEE_ORDER_HEADERS = [
  "ID do pedido", "Status do pedido", "Hot Listing", "Status da Devolução / Reembolso",
  "Número de rastreamento", "Opção de envio", "Método de envio", "Data prevista de envio",
  "Tempo de Envio", "Data de criação do pedido", "Hora do pagamento do pedido",
  "Nº de referência do SKU principal", "Nome do Produto", "Número de referência SKU",
  "Nome da variação", "Preço original", "Preço acordado", "Quantidade", "Returned quantity",
  "Subtotal do produto", "Desconto do vendedor", "Desconto do vendedor", "Peso total SKU",
  "Número de produtos pedidos", "Valor Total", "Taxa de envio pagas pelo comprador",
  "Desconto de Frete Aproximado", "Taxa de Envio Reversa", "Taxa de transação",
  "Taxa de comissão bruta", "Taxa de comissão líquida", "Taxa de serviço bruta",
  "Taxa de serviço líquida", "Total global", "Valor estimado do frete",
];

const SHOPEE_ADS_HEADERS = [
  "#", "Nome do Anúncio", "Status", "Tipos de Anúncios", "ID do produto", "Criativo",
  "Método de Lance", "Posicionamento", "Data de Início", "Data de Encerramento",
  "Impressões", "Cliques", "CTR", "Adicionar ao carrinho", "Taxa de adição ao carrinho",
  "Conversões", "Conversões Diretas", "Itens Vendidos", "GMV", "Despesas", "ROAS", "ACOS",
];

describe("guessMapping — exportação real da Shopee", () => {
  const mapping = guessMapping(SHOPEE_ORDER_HEADERS, ORDER_IMPORT_FIELDS);

  it("pega a data de criação do pedido, não a data prevista de envio", () => {
    expect(mapping.orderedAt).toBe("Data de criação do pedido");
  });

  it("pega o SKU da variação, que é o preenchido, e não o SKU principal em branco", () => {
    expect(mapping.sku).toBe("Número de referência SKU");
  });

  it("usa o subtotal do item como receita, não o valor total com frete do comprador", () => {
    expect(mapping.grossAmount).toBe("Subtotal do produto");
  });

  it("separa comissão de taxa de serviço em vez de cair no frete do comprador", () => {
    expect(mapping.commissionAmount).toBe("Taxa de comissão bruta");
    expect(mapping.marketplaceFeeAmount).toBe("Taxa de serviço bruta");
  });

  it("não adivinha frete pago pelo vendedor — essa coluna não existe nesse relatório", () => {
    expect(mapping.shippingSubsidizedByMerchant).toBeNull();
  });

  it("nunca aponta dois campos para a mesma coluna", () => {
    const used = Object.values(mapping).filter((v): v is string => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it("reconhece o relatório de anúncios da Shopee", () => {
    const ads = guessMapping(SHOPEE_ADS_HEADERS, ADS_IMPORT_FIELDS);
    expect(ads.campaignName).toBe("Nome do Anúncio");
    expect(ads.spend).toBe("Despesas");
    expect(ads.attributedRevenue).toBe("GMV");
    expect(ads.orders).toBe("Conversões");
  });
});

describe("detectHeaderRow — arquivos com preâmbulo", () => {
  it("pula as linhas de metadados do relatório de anúncios da Shopee", () => {
    const matrix = [
      ["Relatório de Todos os Anúncios CPC - Shopee Brasil"],
      ["Nome de Usuário", "archistoreoficial"],
      ["Nome da loja", "Archi Store"],
      ["ID da Loja", "1834121824"],
      ["Data de Criação do Relatório", "20/08/2026 19:36"],
      ["Período", "01/05/2026 - 29/07/2026"],
      [],
      SHOPEE_ADS_HEADERS,
      ["1", "Campanha X"],
    ];
    expect(detectHeaderRow(matrix)).toBe(7);
  });

  it("mantém a primeira linha quando o arquivo já começa no cabeçalho", () => {
    expect(detectHeaderRow([SHOPEE_ORDER_HEADERS, ["260821UCHMVRK5", "A Enviar"]])).toBe(0);
  });

  it("prefere a linha mais larga mais acima quando há empate", () => {
    expect(detectHeaderRow([["a", "b", "c"], ["d", "e", "f"]])).toBe(0);
  });
});

describe("normalizeOrderStatus — status reais da Shopee", () => {
  it("trata 'A Enviar' como pago e ainda não enviado", () => {
    expect(normalizeOrderStatus("A Enviar")).toBe("PAID");
    expect(normalizeOrderStatus("Envio pendente")).toBe("PAID");
  });

  it("trata 'Não pago' como pedido criado, sem receita", () => {
    expect(normalizeOrderStatus("Não pago")).toBe("CREATED");
  });

  it("não confunde o prazo de devolução com uma devolução de verdade", () => {
    // Shopee carimba pedidos entregues com esse texto. Ler como devolvido
    // apagaria a venda: são 194 das 2977 linhas de um mês real.
    expect(normalizeOrderStatus("O comprador pode pedir uma devolução até 2026-08-22")).toBe("DELIVERED");
    expect(normalizeOrderStatus("O comprador pode solicitar reembolso até 25/08/2026")).toBe("DELIVERED");
  });

  it("reconhece devolução de verdade, com e sem acento", () => {
    expect(normalizeOrderStatus("Devolvido")).toBe("RETURNED");
    expect(normalizeOrderStatus("Devolução")).toBe("RETURNED");
    expect(normalizeOrderStatus("Em devolução")).toBe("RETURNED");
  });

  it("continua reconhecendo enviado, concluído e cancelado", () => {
    expect(normalizeOrderStatus("Enviado")).toBe("SHIPPED");
    expect(normalizeOrderStatus("Concluído")).toBe("DELIVERED");
    expect(normalizeOrderStatus("Cancelado")).toBe("CANCELED");
  });
});
