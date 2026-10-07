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
  /** Código do mecanismo de push. Guardado para diagnóstico, não para decidir. */
  code: number;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * O que fazer com um push é decidido pelo conteúdo, não pelo código.
 *
 * Cada mecanismo da Shopee tem o seu número — `reserved_stock_change_push` é
 * 8, e a lista cresce com o catálogo deles. Fixar "3 é pedido" em código vira
 * uma aposta que quebra calada quando a numeração muda ou quando um push novo
 * também passa a citar pedido: o aviso chega, não casa com nenhum caso
 * conhecido e é arquivado sem ação, exatamente como se tivesse se perdido.
 *
 * Um push que cita um número de pedido faz o pedido ser reconsultado. Isso
 * independe de código, vale para os mecanismos que ainda nem existem, e é
 * seguro porque a aplicação nunca acredita no conteúdo do push: ela usa o
 * aviso só como gatilho e vai buscar o estado atual na API. É também o que
 * torna inofensiva a entrega fora de ordem que a Shopee avisa não garantir —
 * dois pushes do mesmo pedido em qualquer ordem levam ao mesmo resultado.
 */
/**
 * Nome do mecanismo por código, só para a tela falar em vez de numerar.
 *
 * Nenhuma decisão passa por aqui — essa é a diferença entre um rótulo e uma
 * regra. Um código ausente desta tabela continua sendo tratado normalmente; a
 * tela apenas mostra o número, que é a verdade disponível.
 */
const NOMES_DE_PUSH: Record<number, string> = {
  2: "shop_authorization_canceled_push",
  3: "order_status_push",
  8: "reserved_stock_change_push",
};

export function nomeDoPush(code: number): string {
  return NOMES_DE_PUSH[code] ?? `código ${code}`;
}

export function citaPedido(envelope: ShopeePushEnvelope): boolean {
  return pedidoDoPush(envelope) !== null;
}

/**
 * Os poucos códigos que precisam de tratamento próprio por não citarem pedido
 * nenhum. Configuráveis porque são justamente os que não dá para deduzir do
 * conteúdo, e um número errado aqui só desliga um caso especial — nunca
 * impede um pedido de entrar.
 */
export function ehDesautorizacao(envelope: ShopeePushEnvelope, codigos: number[]): boolean {
  return codigos.includes(envelope.code);
}

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

/**
 * Qual URL, entre as plausíveis, produz a assinatura recebida.
 *
 * Uma assinatura que não bate tem duas causas possíveis e indistinguíveis pelo
 * sintoma: a base usada difere da cadastrada no console, ou a chave é outra.
 * Em vez de pedir que alguém compare dois endereços caractere a caractere —
 * com `https` contra `http`, barra no fim, domínio de branch contra domínio de
 * produção —, isto pergunta empiricamente: assina com cada candidata e diz
 * qual delas reproduz o que a Shopee mandou.
 *
 * O resultado separa as duas causas de uma vez. Alguma bate: é URL, e o
 * conserto é configurar `SHOPEE_PUSH_URL` com aquele valor exato. Nenhuma
 * bate: a chave é outra, e comparar URLs seria perder tempo no lugar errado.
 *
 * Mesma ideia do diagnóstico que resolveu o `error_sign`: perguntar ao outro
 * lado em vez de deduzir.
 */
export function encontrarBaseQueAssina(input: {
  candidatas: string[];
  rawBody: string;
  authorization: string | null;
  partnerKey: string;
  encoding?: ShopeeKeyEncoding;
}): string | null {
  const recebida = (input.authorization ?? "").trim().toLowerCase();
  if (!recebida) return null;

  const chave = resolveShopeeKey(input.partnerKey, input.encoding ?? "raw");

  for (const candidata of input.candidatas) {
    if (shopeeSign(chave, `${candidata}|${input.rawBody}`).toLowerCase() === recebida) return candidata;
  }
  return null;
}

/**
 * As variações que valem testar para uma mesma URL.
 *
 * São as diferenças que ninguém enxerga lendo: a barra no fim, e o esquema.
 */
export function variacoesDeUrl(url: string): string[] {
  const limpa = url.trim();
  if (!limpa) return [];

  const semBarra = limpa.replace(/\/+$/, "");
  const variacoes = new Set([semBarra, `${semBarra}/`]);

  if (semBarra.startsWith("https://")) variacoes.add(semBarra.replace("https://", "http://"));
  if (semBarra.startsWith("http://")) variacoes.add(semBarra.replace("http://", "https://"));

  return [...variacoes];
}
