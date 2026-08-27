import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopeeProvider } from "../providers/shopee";

afterEach(() => vi.restoreAllMocks());

const KEY = `shpk${"a".repeat(60)}`;

function captureExchange(body: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("ShopeeProvider.exchangeAuthorizationCode", () => {
  it("manda o shop_id no corpo — sem ele a Shopee recusa a troca", async () => {
    const spy = captureExchange({
      access_token: "at",
      refresh_token: "rt",
      expire_in: 14400,
      shop_id: 987654,
    });

    const provider = new ShopeeProvider("2042290", KEY, "https://x/cb", "live");
    const token = await provider.exchangeAuthorizationCode("codigo-da-shopee", "987654");

    const sent = JSON.parse(String(spy.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(sent.code).toBe("codigo-da-shopee");
    expect(sent.shop_id).toBe(987654);
    expect(sent.partner_id).toBe(2042290);
    expect(token.externalShopId).toBe("987654");
    expect(token.accessToken).toBe("at");
  });

  it("não inventa um shop_id quando o redirect não trouxe nenhum", async () => {
    const spy = captureExchange({ access_token: "at", refresh_token: "rt", expire_in: 14400, shop_id: 1 });
    await new ShopeeProvider("2042290", KEY, "https://x/cb", "live").exchangeAuthorizationCode("c");

    const sent = JSON.parse(String(spy.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(sent.shop_id).toBeUndefined();
  });

  it("propaga o erro da Shopee em vez de devolver um token vazio", async () => {
    captureExchange({ error: "error_param", message: "shop_id is required" });

    await expect(
      new ShopeeProvider("2042290", KEY, "https://x/cb", "live").exchangeAuthorizationCode("c", "1"),
    ).rejects.toThrow(/error_param/);
  });
});

describe("ShopeeProvider.getAuthorizationUrl", () => {
  it("embute o state no redirect, não ao lado dele", () => {
    // A Shopee só acrescenta code e shop_id ao redirect registrado. Um state
    // posto como parâmetro do auth_partner some na volta, e o callback recebe
    // uma autorização válida sem saber de qual workspace ela veio.
    const provider = new ShopeeProvider("2042290", KEY, "https://app.exemplo/api/integrations/shopee/callback", "live");
    const url = new URL(provider.getAuthorizationUrl("assinado.123"));

    expect(url.searchParams.get("state")).toBeNull();

    const redirect = new URL(url.searchParams.get("redirect")!);
    expect(redirect.origin + redirect.pathname).toBe("https://app.exemplo/api/integrations/shopee/callback");
    expect(redirect.searchParams.get("state")).toBe("assinado.123");
  });

  it("assina o auth_partner com a chave configurada", () => {
    const url = new URL(
      new ShopeeProvider("2042290", KEY, "https://app.exemplo/cb", "live").getAuthorizationUrl("s"),
    );
    expect(url.host).toBe("partner.shopeemobile.com");
    expect(url.searchParams.get("partner_id")).toBe("2042290");
    expect(url.searchParams.get("sign")).toMatch(/^[0-9a-f]{64}$/);
  });
});
