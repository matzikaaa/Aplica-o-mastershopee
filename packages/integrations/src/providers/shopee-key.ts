import { createHmac } from "node:crypto";

/**
 * Como a Shopee mostra a partner_key, e por que isso não é óbvio.
 *
 * O console do Open Platform exibe a chave como `shpk` seguido de 60
 * caracteres hexadecimais. A documentação não diz se essa string *é* a
 * chave do HMAC ou apenas o formato em que ela é impressa — e as duas
 * leituras são plausíveis: decodificar os 60 hex dá exatamente 30 bytes
 * ASCII imprimíveis, o que não é o que bytes aleatórios parecem.
 *
 * Assinar com a leitura errada devolve `error_sign`, que é o mesmo erro de
 * chave trocada, ambiente errado e relógio fora de hora. Em vez de escolher
 * uma leitura e torcer, enumeramos as leituras aqui para o `diagnose`
 * perguntar à Shopee qual delas ela aceita.
 */
export type ShopeeKeyEncoding = "raw" | "stripped" | "hex-decoded";

export interface ShopeeKeyCandidate {
  encoding: ShopeeKeyEncoding;
  /** Bytes que vão para o HMAC. Nunca serializado em resposta alguma. */
  key: Buffer;
  /** Tamanho em bytes — este sim é seguro de reportar. */
  byteLength: number;
}

const SHPK_PREFIX = /^shpk/i;

export function shopeeKeyCandidates(partnerKey: string): ShopeeKeyCandidate[] {
  const trimmed = partnerKey.trim();
  const out: ShopeeKeyCandidate[] = [];

  const push = (encoding: ShopeeKeyEncoding, key: Buffer) => {
    if (key.length === 0) return;
    // Uma chave sem o prefixo `shpk` faz "raw" e "stripped" coincidirem;
    // sondar a mesma chave duas vezes só gastaria uma chamada à Shopee.
    if (out.some((c) => c.key.equals(key))) return;
    out.push({ encoding, key, byteLength: key.length });
  };

  push("raw", Buffer.from(trimmed, "utf8"));

  const stripped = trimmed.replace(SHPK_PREFIX, "");
  push("stripped", Buffer.from(stripped, "utf8"));

  if (stripped.length % 2 === 0 && /^[0-9a-f]+$/i.test(stripped)) {
    push("hex-decoded", Buffer.from(stripped, "hex"));
  }

  return out;
}

/**
 * Devolve os bytes da leitura pedida. Se a leitura não se aplica a esta
 * chave (pedir `hex-decoded` de algo que não é hexadecimal, por exemplo),
 * cai para a chave como veio — assinar com o valor exibido é o
 * comportamento que já existia e o `diagnose` continua dizendo a verdade
 * sobre o que a Shopee aceitou.
 */
export function resolveShopeeKey(partnerKey: string, encoding: ShopeeKeyEncoding): Buffer {
  const candidates = shopeeKeyCandidates(partnerKey);
  const found = candidates.find((c) => c.encoding === encoding);
  return found?.key ?? Buffer.from(partnerKey.trim(), "utf8");
}

export function shopeeSign(key: Buffer, base: string): string {
  return createHmac("sha256", key).update(base).digest("hex");
}
