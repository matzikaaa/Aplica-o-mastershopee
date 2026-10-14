import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopeeProvider } from "../providers/shopee";

afterEach(() => vi.restoreAllMocks());

const KEY = `shpk${"a".repeat(60)}`;
const credenciais = { accessToken: "token", externalShopId: "123" };
const CHAVE = "35260911222333000181550010000012341123456787";

const responder = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

/**
 * Uma Shopee de mentira: devolve detalhe e escrow pelo caminho chamado, e
 * deixa decidir o que fazer quando a nota é pedida.
 */
function shopee(opcoes: { recusaNota?: boolean; erroDoDetalhe?: string } = {}) {
  const chamadas: URL[] = [];
  const spy = vi.fn(async (endereco: string) => {
    const url = new URL(endereco);
    chamadas.push(url);
    if (url.pathname === "/api/v2/order/get_order_detail") {
      const campos = url.searchParams.get("response_optional_fields") ?? "";
      if (opcoes.erroDoDetalhe) return responder({ error: opcoes.erroDoDetalhe, message: "falhou" });
      if (opcoes.recusaNota && campos.includes("invoice_data")) {
        return responder({ error: "error_param", message: "response_optional_fields inválido" });
      }
      const sns = (url.searchParams.get("order_sn_list") ?? "").split(",");
      return responder({
        response: {
          order_list: sns.map((sn, i) => ({
            order_sn: sn,
            order_status: "COMPLETED",
            create_time: 1_789_000_000,
            currency: "BRL",
            item_list: [{ item_id: 1, item_sku: "SKU-1", model_quantity_purchased: 1, model_original_price: 100 }],
            ...(campos.includes("invoice_data")
              ? { invoice_data: i === 0 ? { number: "1234", series_number: "1", access_key: CHAVE } : null }
              : {}),
          })),
        },
      });
    }
    if (url.pathname === "/api/v2/payment/get_escrow_detail") {
      return responder({ response: { order_income: { escrow_amount: 80, commission_fee: 14 } } });
    }
    return responder({ error: "error_not_found", message: url.pathname });
  });
  vi.stubGlobal("fetch", spy);
  return chamadas;
}

const camposPedidos = (chamadas: URL[]) =>
  chamadas
    .filter((u) => u.pathname === "/api/v2/order/get_order_detail")
    .map((u) => u.searchParams.get("response_optional_fields"));

describe("nota fiscal do pedido Shopee", () => {
  it("pede a nota junto com o detalhe e guarda o que veio no payload", async () => {
    const chamadas = shopee();
    const pedidos = await new ShopeeProvider("1", KEY, "https://x/cb").fetchOrdersByIds(credenciais, ["A", "B"]);

    expect(camposPedidos(chamadas)[0]).toContain("invoice_data");
    const raw = pedidos[0]!.raw as { detail: { invoice_data: { access_key: string } } };
    expect(raw.detail.invoice_data.access_key).toBe(CHAVE);
    expect((pedidos[1]!.raw as { detail: { invoice_data: unknown } }).detail.invoice_data).toBeNull();
  });

  it("se a Shopee recusa o campo da nota, os pedidos entram sem ela — e a rodada não insiste", async () => {
    const chamadas = shopee({ recusaNota: true });
    const provider = new ShopeeProvider("1", KEY, "https://x/cb");

    const primeira = await provider.fetchOrdersByIds(credenciais, ["A"]);
    const segunda = await provider.fetchOrdersByIds(credenciais, ["B"]);

    expect(primeira).toHaveLength(1);
    expect(segunda).toHaveLength(1);
    // Com a nota (recusado), sem a nota (aceito), e a segunda já direto sem.
    expect(camposPedidos(chamadas).map((c) => c?.includes("invoice_data"))).toEqual([true, false, false]);
  });

  it("outro erro da Shopee não é engolido como se fosse a nota", async () => {
    shopee({ erroDoDetalhe: "error_auth" });
    await expect(new ShopeeProvider("1", KEY, "https://x/cb").fetchOrdersByIds(credenciais, ["A"])).rejects.toThrow(
      "error_auth",
    );
  });

  it("busca só a nota de pedidos já gravados, de 50 em 50, sem escrow", async () => {
    const chamadas = shopee();
    const sns = Array.from({ length: 60 }, (_, i) => `SN${i}`);
    const notas = await new ShopeeProvider("1", KEY, "https://x/cb").fetchInvoiceData(credenciais, sns);

    expect(camposPedidos(chamadas)).toEqual(["invoice_data", "invoice_data"]);
    expect(chamadas.some((u) => u.pathname.includes("escrow"))).toBe(false);
    expect(notas.size).toBe(60);
    expect(notas.get("SN0")?.access_key).toBe(CHAVE);
    expect(notas.get("SN1")).toBeNull();
  });
});
