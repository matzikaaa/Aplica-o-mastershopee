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
