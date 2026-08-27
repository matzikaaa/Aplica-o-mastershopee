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
function fakeShopeeAccepting(expectedKey: Buffer, onlyHost?: string) {
  const spy = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    if (onlyHost && parsed.host !== onlyHost) {
      return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ error: "error_sign", message: "Wrong sign." }) };
    }
    const partnerId = parsed.searchParams.get("partner_id")!;
    const timestamp = parsed.searchParams.get("timestamp")!;
    const expected = createHmac("sha256", expectedKey)
      .update(`${partnerId}${parsed.pathname}${timestamp}`)
      .digest("hex");

    const body =
      parsed.searchParams.get("sign") === expected
        ? { response: { authed_shop_list: [] } }
        : { error: "error_sign", message: "Wrong sign." };

    return { ok: true, status: 200, headers: new Headers({ date: new Date().toUTCString() }), text: async () => JSON.stringify(body) };
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
    expect(d.signAttempts.map((a) => [a.encoding, a.signVerdict])).toEqual([
      ["raw", "refused"],
      ["stripped", "refused"],
      ["hex-decoded", "accepted"],
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
    // Três leituras × dois ambientes: nada de ambiente trocado sobra como
    // palpite depois disso.
    expect(d.signAttempts).toHaveLength(6);
    expect(d.signAttempts.every((a) => a.signVerdict === "refused")).toBe(true);
    expect(d.problems[0]).toContain("reconhece este partner_id");
    expect(d.problems.join(" ")).toContain("Relógio conferido");
    expect(d.problems.join(" ")).toContain("allowlist de IP");
  });

  it("não confunde invalid_partner_id com assinatura aceita — foi o que inverteu a conclusão uma vez", async () => {
    // O caso real: Live devolve error_sign (achou o parceiro, recusou a
    // assinatura) e test devolve invalid_partner_id (nem procurou a
    // assinatura). Concluir "credenciais são de test" daqui está de cabeça
    // para baixo.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const live = new URL(url).host === "partner.shopeemobile.com";
        return {
          ok: true,
          status: 200,
          headers: new Headers({ date: new Date().toUTCString() }),
          text: async () =>
            JSON.stringify(
              live
                ? { error: "error_sign", message: "Wrong sign." }
                : { error: "invalid_partner_id", message: "Invalid partner_id, please have a check." },
            ),
        };
      }),
    );
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();

    expect(d.ok).toBe(false);
    expect(d.acceptedEnvironment).toBeNull();
    expect(d.signAttempts.filter((a) => a.environment === "test").every((a) => a.signVerdict === "inconclusive")).toBe(true);
    expect(d.problems[0]).toContain("O partner_id está certo e é do ambiente live");
    expect(d.problems[0]).toContain("Não mexa em SHOPEE_ENV");
    expect(d.problems.join(" ")).toContain("impressão digital");
  });

  it("aponta o ambiente trocado quando o outro host aceita a mesma chave", async () => {
    // Credenciais de teste configuradas como Live: mesmo tamanho, mesmo
    // prefixo, indistinguíveis daqui — mas a Shopee sabe.
    fakeShopeeAccepting(Buffer.from(DISPLAYED_KEY, "utf8"), "partner.test-stable.shopeemobile.com");
    const d = await new ShopeeProvider("1241533", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();

    expect(d.ok).toBe(false);
    expect(d.acceptedEnvironment).toBe("test");
    expect(d.problems[0]).toContain("SHOPEE_ENV=test");
  });

  it("mede a diferença de relógio contra a Shopee em vez de deixar como suspeita", async () => {
    const skew = 900;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ date: new Date(Date.now() - skew * 1000).toUTCString() }),
        text: async () => JSON.stringify({ error: "error_sign", message: "Wrong sign." }),
      })),
    );
    const d = await new ShopeeProvider("2042290", DISPLAYED_KEY, "https://x/cb", "live", "raw").diagnose();

    expect(d.clockSkewSeconds).toBeGreaterThan(800);
    expect(d.problems.join(" ")).toContain("fora do horário da Shopee");
    // Com o relógio identificado como causa, não faz sentido mandar conferir
    // a chave e o console também.
    expect(d.problems.join(" ")).not.toContain("allowlist de IP");
  });

  it("para de sondar quando a assinatura passa e o erro é outro", async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ date: new Date().toUTCString() }),
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
    expect(serialized).not.toContain(DISPLAYED_KEY.slice(4));
    expect(d.signAttempts.map((a) => a.keyByteLength)).toEqual([64, 60, 30]);
    expect(d.keyFingerprint).toBe(`${DISPLAYED_KEY.slice(0, 8)}…${DISPLAYED_KEY.slice(-4)}`);
  });
});
