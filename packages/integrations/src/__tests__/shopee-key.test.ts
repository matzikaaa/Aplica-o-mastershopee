import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopeeProvider } from "../providers/shopee";
import { resolveShopeeKey, shopeeKeyCandidates } from "../providers/shopee-key";

afterEach(() => vi.restoreAllMocks());

// Formato real do console da Shopee: `shpk` + 60 hexadecimais que decodificam
// para 30 bytes ASCII imprimíveis — não é o que bytes aleatórios parecem.
const ASCII_KEY = "fIaOcdSmQHUxIGSMFJZWbyhBQnHbOw";
const DISPLAYED_KEY = "shpk" + Buffer.from(ASCII_KEY, "utf8").toString("hex");

describe("shopeeKeyCandidates", () => {
  it("enumera as três leituras da chave exibida pelo console", () => {
    const c = shopeeKeyCandidates(DISPLAYED_KEY);
    expect(c.map((x) => x.encoding)).toEqual(["raw", "stripped", "hex-decoded"]);
    expect(c[2]!.key.toString("utf8")).toBe(ASCII_KEY);
    expect(c[2]!.byteLength).toBe(30);
  });

  it("não sonda a mesma chave duas vezes quando não há prefixo shpk", () => {
    const c = shopeeKeyCandidates("naohexadecimal!!");
    expect(c.map((x) => x.encoding)).toEqual(["raw"]);
  });

  it("ignora a leitura hexadecimal quando o resto não é hexadecimal", () => {
    const c = shopeeKeyCandidates("shpkZZZZ");
    expect(c.map((x) => x.encoding)).toEqual(["raw", "stripped"]);
  });

  it("cai para a chave crua quando a leitura pedida não se aplica", () => {
    expect(resolveShopeeKey("naohex!!", "hex-decoded").toString("utf8")).toBe("naohex!!");
  });

  it("ignora espaço em branco colado junto, que é invisível no .env", () => {
    expect(resolveShopeeKey(` ${DISPLAYED_KEY} `, "hex-decoded").toString("utf8")).toBe(ASCII_KEY);
  });
});

/**
 * Uma Shopee de mentira que só aceita UMA leitura da chave: assina o mesmo
 * base string com a chave esperada e compara. Qualquer outra leitura recebe
 * `error_sign`, exatamente como o servidor real responde.
 */
function fakeShopeeAccepting(expectedKey: Buffer) {
  const spy = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    const partnerId = parsed.searchParams.get("partner_id")!;
    const timestamp = parsed.searchParams.get("timestamp")!;
    const expected = createHmac("sha256", expectedKey)
      .update(`${partnerId}${parsed.pathname}${timestamp}`)
      .digest("hex");

    const body =
      parsed.searchParams.get("sign") === expected
        ? { response: { authed_shop_list: [] } }
        : { error: "error_sign", message: "Wrong sign." };

    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("ShopeeProvider.diagnose — descobrir a leitura da chave perguntando à Shopee", () => {
  it("acha a leitura hex-decoded e diz qual variável de ambiente ajustar", async () => {
    const spy = fakeShopeeAccepting(Buffer.from(ASCII_KEY, "utf8"));
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();

    expect(d.acceptedKeyEncoding).toBe("hex-decoded");
    expect(d.problems[0]).toContain("SHOPEE_KEY_ENCODING=hex-decoded");
    // Não é "ok": a aplicação ainda assina com a leitura errada em produção.
    expect(d.ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(d.signAttempts.map((a) => [a.encoding, a.signAccepted])).toEqual([
      ["raw", false],
      ["stripped", false],
      ["hex-decoded", true],
    ]);
  });

  it("é ok e gasta uma única chamada quando a leitura configurada é a certa", async () => {
    const spy = fakeShopeeAccepting(Buffer.from(ASCII_KEY, "utf8"));
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "hex-decoded").diagnose();

    expect(d.ok).toBe(true);
    expect(d.acceptedKeyEncoding).toBe("hex-decoded");
    expect(d.problems).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("assina de fato com a leitura configurada, não só no diagnóstico", () => {
    const provider = new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "hex-decoded");
    const url = new URL(provider.getAuthorizationUrl("estado"));
    const timestamp = url.searchParams.get("timestamp")!;
    const expected = createHmac("sha256", Buffer.from(ASCII_KEY, "utf8"))
      .update(`2042290/api/v2/shop/auth_partner${timestamp}`)
      .digest("hex");

    expect(url.searchParams.get("sign")).toBe(expected);
  });

  it("quando nenhuma leitura passa, o problema não é a codificação — e o relatório diz isso", async () => {
    fakeShopeeAccepting(Buffer.from("outra-chave-completamente-diferente", "utf8"));
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();

    expect(d.ok).toBe(false);
    expect(d.acceptedKeyEncoding).toBeNull();
    expect(d.signAttempts).toHaveLength(3);
    expect(d.signAttempts.every((a) => !a.signAccepted)).toBe(true);
    expect(d.problems[0]).toContain("ambiente");
    expect(d.problems[0]).toContain("relógio");
  });

  it("para de sondar quando a assinatura passa e o erro é outro", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: "error_permission", message: "no access" }),
    }));
    vi.stubGlobal("fetch", spy);
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(d.acceptedKeyEncoding).toBe("raw");
    expect(d.shopeeError).toContain("error_permission");
  });

  it("nunca devolve a chave, nem derivada, só o tamanho em bytes", async () => {
    fakeShopeeAccepting(Buffer.from(ASCII_KEY, "utf8"));
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();
    const serialized = JSON.stringify(d);

    expect(serialized).not.toContain(ASCII_KEY);
    expect(serialized).not.toContain(DISPLAYED_KEY);
    expect(d.signAttempts.map((a) => a.keyByteLength)).toEqual([64, 60, 30]);
  });
});
