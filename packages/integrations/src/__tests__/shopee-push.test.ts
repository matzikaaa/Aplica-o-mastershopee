import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SHOPEE_PUSH_CODE,
  parseShopeePush,
  pedidoDoPush,
  verifyShopeePush,
} from "../providers/shopee-push";

const CHAVE = "shpk4b41507041474f4b4c7a575351495655557254525948485075444e745772";
const URL_PUSH = "https://app.exemplo.com/api/webhooks/shopee";

function assinar(url: string, corpo: string, chave = CHAVE) {
  return createHmac("sha256", chave).update(`${url}|${corpo}`).digest("hex");
}

describe("assinatura do push", () => {
  const corpo = JSON.stringify({ shop_id: 123, code: 3, timestamp: 1700000000, data: { ordersn: "A1" } });

  it("aceita a assinatura correta", () => {
    const r = verifyShopeePush({
      pushUrl: URL_PUSH,
      rawBody: corpo,
      authorization: assinar(URL_PUSH, corpo),
      partnerKey: CHAVE,
    });
    expect(r.valida).toBe(true);
  });

  it("aceita assinatura em maiúsculas", () => {
    const r = verifyShopeePush({
      pushUrl: URL_PUSH,
      rawBody: corpo,
      authorization: assinar(URL_PUSH, corpo).toUpperCase(),
      partnerKey: CHAVE,
    });
    expect(r.valida).toBe(true);
  });

  it("recusa quando a URL cadastrada é outra", () => {
    // O caso real: atrás do proxy da Vercel o host chega reescrito, e montar
    // a base com o que a requisição informa produz exatamente isto.
    const r = verifyShopeePush({
      pushUrl: "https://outro-host.vercel.app/api/webhooks/shopee",
      rawBody: corpo,
      authorization: assinar(URL_PUSH, corpo),
      partnerKey: CHAVE,
    });
    expect(r.valida).toBe(false);
  });

  it("recusa quando o corpo foi remontado", () => {
    // Mesmo JSON, chaves em outra ordem: continua sendo o mesmo dado e já não
    // é a mesma string. Por isso a verificação exige o corpo cru.
    const remontado = JSON.stringify({ code: 3, shop_id: 123, timestamp: 1700000000, data: { ordersn: "A1" } });
    const r = verifyShopeePush({
      pushUrl: URL_PUSH,
      rawBody: remontado,
      authorization: assinar(URL_PUSH, corpo),
      partnerKey: CHAVE,
    });
    expect(r.valida).toBe(false);
  });

  it("recusa assinatura ausente, vazia ou de outra chave", () => {
    for (const auth of [null, "", assinar(URL_PUSH, corpo, "outra-chave")]) {
      expect(verifyShopeePush({ pushUrl: URL_PUSH, rawBody: corpo, authorization: auth, partnerKey: CHAVE }).valida).toBe(
        false,
      );
    }
  });

  it("devolve prefixos para diagnóstico, sem expor a chave", () => {
    const r = verifyShopeePush({ pushUrl: URL_PUSH, rawBody: corpo, authorization: "deadbeef", partnerKey: CHAVE });
    expect(r.esperadaPrefixo).toHaveLength(8);
    expect(r.recebidaPrefixo).toBe("deadbeef");
    expect(r.esperadaPrefixo).not.toContain(CHAVE.slice(0, 8));
  });
});

describe("leitura do envelope", () => {
  it("lê os campos que importam", () => {
    const e = parseShopeePush(
      JSON.stringify({ shop_id: 98765, code: 3, timestamp: 1700000000, data: { ordersn: "250101ABC" } }),
    );
    expect(e).toMatchObject({ shopId: "98765", code: SHOPEE_PUSH_CODE.STATUS_DO_PEDIDO, timestamp: 1700000000 });
    expect(pedidoDoPush(e!)).toBe("250101ABC");
  });

  it("aceita order_sn além de ordersn", () => {
    const e = parseShopeePush(JSON.stringify({ code: 3, data: { order_sn: "XYZ" } }));
    expect(pedidoDoPush(e!)).toBe("XYZ");
  });

  it("devolve null para push sem pedido", () => {
    const e = parseShopeePush(JSON.stringify({ code: 1, shop_id: 1, data: {} }));
    expect(pedidoDoPush(e!)).toBeNull();
  });

  it("devolve null para corpo ilegível ou sem código", () => {
    expect(parseShopeePush("não é json")).toBeNull();
    expect(parseShopeePush(JSON.stringify({ data: {} }))).toBeNull();
  });

  it("não perde o shop_id quando ele vem como número grande", () => {
    // shop_id passa de 2^53 em algumas regiões; virar número perderia dígitos
    // e a conta nunca seria encontrada.
    const e = parseShopeePush(JSON.stringify({ shop_id: 1234567890123, code: 3, data: {} }));
    expect(e?.shopId).toBe("1234567890123");
  });
});
