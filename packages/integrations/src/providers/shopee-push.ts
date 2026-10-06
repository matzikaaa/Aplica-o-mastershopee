import { timingSafeEqual } from "node:crypto";
import { resolveShopeeKey, shopeeSign, type ShopeeKeyEncoding } from "./shopee-key";

/**
 * O Push Mechanism da Shopee: ela avisa quando um pedido muda, em vez de
 * perguntarmos de minuto em minuto.
 *
 * A assinatura segue o mesmo desenho das chamadas de API — HMAC-SHA256 sobre
 * uma string base, com o partner_key —, mas a base é outra: aqui é a **URL de
 * push exatamente como está cadastrada no console**, um pipe, e o corpo cru da
 * requisição. Dois detalhes decidem se funciona ou não:
 *
 * A URL tem que ser a cadastrada, não a que o servidor acha que recebeu. Atrás
 * do proxy da Vercel o host e o protocolo chegam reescritos, e montar a base
 * com o que a requisição informa gera uma assinatura que nunca bate — com a
 * configuração visivelmente correta na tela.
 *
 * E o corpo tem que ser o texto cru, antes de qualquer `JSON.parse`. Serializar
 * de novo reordena chaves e muda espaços; o resultado continua sendo o mesmo
 * JSON e já não é mais a mesma string.
 */

export interface ShopeePushEnvelope {
  shopId: string | null;
  /** Código do tipo de push. Ver `SHOPEE_PUSH_CODE`. */
  code: number;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Os códigos que esta aplicação trata. Os demais são guardados sem ação:
 * registrar um push que não sabemos interpretar é melhor do que descartá-lo,
 * porque é o registro que mostra que ele existe.
 */
export const SHOPEE_PUSH_CODE = {
  AUTORIZACAO: 1,
  DESAUTORIZACAO: 2,
  STATUS_DO_PEDIDO: 3,
} as const;

export function parseShopeePush(rawBody: string): ShopeePushEnvelope | null {
  try {
    const lido = JSON.parse(rawBody) as Record<string, unknown>;
    const code = Number(lido.code);
    if (!Number.isFinite(code)) return null;

    return {
      shopId: lido.shop_id != null ? String(lido.shop_id) : null,
      code,
      timestamp: Number(lido.timestamp) || 0,
      data: (lido.data as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

/** O número do pedido que o push cita, se ele citar algum. */
export function pedidoDoPush(envelope: ShopeePushEnvelope): string | null {
  // A Shopee escreve `ordersn` neste canal e `order_sn` nas respostas de API.
  // Aceitar os dois custa uma linha e evita um push silenciosamente ignorado.
  const bruto = envelope.data.ordersn ?? envelope.data.order_sn;
  const sn = typeof bruto === "string" ? bruto.trim() : "";
  return sn.length > 0 ? sn : null;
}

export interface VerificacaoPush {
  valida: boolean;
  /** O que foi calculado, para diagnóstico. Prefixo apenas — nunca a chave. */
  esperadaPrefixo: string;
  recebidaPrefixo: string;
}

/**
 * Confere a assinatura de um push.
 *
 * Devolve o prefixo das duas assinaturas junto com o veredito. Comparar oito
 * caracteres não entrega nada a quem não tem o partner_key, e é o que permite
 * dizer "a assinatura não bate" em vez de deixar o operador adivinhando entre
 * URL errada, chave errada e corpo remontado — três causas com o mesmo
 * sintoma, e a diferença entre consertar em um minuto ou passar um dia.
 */
export function verifyShopeePush(input: {
  pushUrl: string;
  rawBody: string;
  authorization: string | null;
  partnerKey: string;
  encoding?: ShopeeKeyEncoding;
}): VerificacaoPush {
  const recebida = (input.authorization ?? "").trim().toLowerCase();
  const chave = resolveShopeeKey(input.partnerKey, input.encoding ?? "raw");
  const esperada = shopeeSign(chave, `${input.pushUrl}|${input.rawBody}`).toLowerCase();

  const prefixo = (v: string) => (v.length >= 8 ? v.slice(0, 8) : v);

  // Comparação de tempo constante: comparar com `===` vaza, pelo tempo de
  // resposta, quantos caracteres iniciais um atacante acertou.
  let valida = false;
  if (recebida.length === esperada.length && recebida.length > 0) {
    valida = timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
  }

  return { valida, esperadaPrefixo: prefixo(esperada), recebidaPrefixo: prefixo(recebida) };
}
