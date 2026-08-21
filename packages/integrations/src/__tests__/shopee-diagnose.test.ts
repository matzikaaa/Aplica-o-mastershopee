import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopeeProvider } from "../providers/shopee";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const KEY = "a".repeat(64);

describe("ShopeeProvider.diagnose — achar a causa sem gastar um redirect", () => {
  it("aponta credencial faltando antes de chamar a Shopee", async () => {
    const spy = mockFetch({});
    const d = await new ShopeeProvider("", "", "", "live").diagnose();

    expect(d.ok).toBe(false);
    expect(d.problems.join(" ")).toContain("SHOPEE_PARTNER_ID");
    expect(spy).not.toHaveBeenCalled();
  });

  it("pega espaço em branco colado junto, que é invisível no .env", async () => {
    const d = await new ShopeeProvider(" 123456 ", ` ${KEY} `, "https://x/cb", "live").diagnose();
    expect(d.problems.some((p) => p.includes("espaço em branco"))).toBe(true);
  });

  it("avisa quando o partner_id não é numérico — chave colada no campo errado", async () => {
    const d = await new ShopeeProvider(KEY, KEY, "https://x/cb", "live").diagnose();
    expect(d.problems.some((p) => p.includes("só dígitos"))).toBe(true);
  });

  it("usa o host de teste quando o ambiente é test", async () => {
    const spy = mockFetch({ response: { authed_shop_list: [] } });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "test").diagnose();

    expect(d.environment).toBe("test");
    expect(spy.mock.calls[0]![0]).toContain("partner.test-stable.shopeemobile.com");
    expect(d.ok).toBe(true);
  });

  it("traduz error_sign apontando o ambiente oposto, sem esconder o código", async () => {
    mockFetch({ error: "error_sign", message: "wrong sign" });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "live").diagnose();

    expect(d.ok).toBe(false);
    expect(d.shopeeError).toBe("error_sign — wrong sign");
    expect(d.problems[0]).toContain("test");
    expect(d.problems[0]).toContain("relógio");
  });

  it("traduz invalid_partner_id da mesma forma", async () => {
    mockFetch({ error: "invalid_partner_id" });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "test").diagnose();
    expect(d.problems[0]).toContain("live");
  });

  it("nunca devolve as credenciais, só o tamanho delas", async () => {
    mockFetch({ response: { authed_shop_list: [] } });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "live").diagnose();
    const serialized = JSON.stringify(d);

    expect(serialized).not.toContain(KEY);
    expect(d.partnerKeyLength).toBe(64);
    expect(d.partnerIdLength).toBe(6);
  });

  it("sobrevive a uma resposta que não é JSON", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "<html>bad gateway</html>" });
    vi.stubGlobal("fetch", spy);
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "live").diagnose();

    expect(d.ok).toBe(false);
    expect(d.shopeeError).toContain("bad gateway");
  });

  it("reporta falha de rede em vez de estourar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "live").diagnose();

    expect(d.ok).toBe(false);
    expect(d.problems[0]).toContain("ENOTFOUND");
  });
});
