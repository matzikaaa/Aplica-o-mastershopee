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

// Formato real do console: `shpk` + 60 hexadecimais. Um valor fora desse
// formato é recusado antes de qualquer chamada, então o fixture precisa ser
// bem formado para os testes exercitarem a sondagem de verdade.
const KEY = `shpk${"a".repeat(60)}`;

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

  it("pega chave fora do formato do console antes de gastar uma chamada", async () => {
    const spy = mockFetch({});
    const d = await new ShopeeProvider("123456", "a".repeat(64), "https://x/cb", "live").diagnose();

    expect(d.keyFormatOk).toBe(false);
    expect(d.problems.some((p) => p.includes("formato"))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("usa o host de teste quando o ambiente é test", async () => {
    const spy = mockFetch({ response: { authed_shop_list: [] } });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "test").diagnose();

    expect(d.environment).toBe("test");
    expect(spy.mock.calls[0]![0]).toContain("partner.test-stable.shopeemobile.com");
    expect(d.ok).toBe(true);
  });

  it("quando error_sign resiste a tudo, relata o que foi eliminado — não repete a suspeita", async () => {
    mockFetch({ error: "error_sign", message: "wrong sign" });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "live").diagnose();

    expect(d.ok).toBe(false);
    expect(d.shopeeError).toBe("error_sign — wrong sign");
    // Sondou os dois ambientes, então "ambiente trocado" deixa de ser palpite.
    expect(new Set(d.signAttempts.map((a) => a.environment))).toEqual(new Set(["live", "test"]));
    expect(d.problems[0]).toContain("descarta");
    expect(d.problems.join(" ")).toContain("allowlist de IP");
  });

  it("traduz invalid_partner_id da mesma forma", async () => {
    mockFetch({ error: "invalid_partner_id" });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "test").diagnose();
    expect(d.problems[0]).toContain("live");
  });

  it("nunca devolve as credenciais, só tamanho e impressão digital", async () => {
    mockFetch({ response: { authed_shop_list: [] } });
    const d = await new ShopeeProvider("123456", KEY, "https://x/cb", "live").diagnose();
    const serialized = JSON.stringify(d);

    expect(serialized).not.toContain(KEY);
    expect(d.partnerKeyLength).toBe(64);
    expect(d.partnerIdLength).toBe(6);
    // Só o suficiente para distinguir a chave de Test da de Live.
    expect(d.keyFingerprint).toBe(`${KEY.slice(0, 8)}…${KEY.slice(-4)}`);
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
    // Rede caída não é assinatura recusada: nada foi eliminado, e o relatório
    // não pode fingir que foi.
    expect(d.problems[0]).toContain("ENOTFOUND");
    expect(d.problems[0]).not.toContain("descarta");
  });
});
