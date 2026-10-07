/**
 * A URL de push, exatamente como ela está cadastrada no console da Shopee.
 *
 * Fica numa variável própria, e não é deduzida da requisição recebida, porque
 * a assinatura do push é calculada sobre essa string: atrás do proxy da Vercel
 * o host e o protocolo chegam reescritos, e montar a base com o que a
 * requisição informa gera uma assinatura que nunca bate — com a configuração
 * visivelmente correta na tela.
 *
 * O padrão deriva de APP_URL, que é o caso comum e dispensa mais uma variável;
 * `SHOPEE_PUSH_URL` existe para quando a URL cadastrada for outra (um domínio
 * próprio, por exemplo).
 */
export function shopeePushUrl(): string {
  const explicita = process.env.SHOPEE_PUSH_URL?.trim();
  if (explicita) return explicita.replace(/\/$/, "");

  const base = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "").trim().replace(/\/$/, "");
  return `${base}/api/webhooks/shopee`;
}

/**
 * A chave que assina os pushes — que **não é** o `partner_key` da API.
 *
 * O console gera uma *Live Push Partner Key* própria, num botão "Generate" ao
 * lado do campo. Assinar push com a chave das chamadas de API produz uma
 * assinatura que nunca bate, com as duas chaves visivelmente corretas em seus
 * lugares — a mesma armadilha do `error_sign`, de novo, e com a mesma cara.
 *
 * O retorno traz a origem junto porque é isso que a mensagem de recusa precisa
 * dizer: "assinei com a chave de API, e o console provavelmente gerou uma
 * própria" é um diagnóstico; "assinatura não confere" não é.
 */
export function shopeePushKey(): { chave: string | null; origem: "push" | "api" } {
  const push = process.env.SHOPEE_PUSH_PARTNER_KEY?.trim();
  if (push) return { chave: push, origem: "push" };

  const api = process.env.SHOPEE_PARTNER_KEY?.trim();
  return { chave: api ?? null, origem: "api" };
}
