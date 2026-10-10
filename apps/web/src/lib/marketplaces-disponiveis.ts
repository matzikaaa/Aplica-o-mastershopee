/**
 * O que a página de vendas pode prometer — num lugar só.
 *
 * A página dizia "Conecte Shopee, Mercado Livre, SHEIN e TikTok Shop" quando
 * só a Shopee sincroniza em produção: o Mercado Livre depende do worker, que
 * não está hospedado, e SHEIN e TikTok Shop ainda não têm integração. Cliente
 * que assina por causa de um marketplace que não funciona pede o dinheiro de
 * volta — e, no Brasil, oferta anunciada vincula o fornecedor (CDC, arts. 30 e
 * 35). A promessa do site é a parte do produto com consequência jurídica.
 *
 * Mudou a disponibilidade? Muda aqui, e o site inteiro acompanha.
 */
export const MARKETPLACES_DISPONIVEIS = ["Shopee"] as const;
export const MARKETPLACES_EM_BREVE = ["Mercado Livre", "SHEIN", "TikTok Shop"] as const;

/** "Shopee", "Shopee e Mercado Livre", "Shopee, ML e SHEIN"… */
export function listaDisponiveis(): string {
  const l = [...MARKETPLACES_DISPONIVEIS];
  if (l.length <= 1) return l.join("");
  return `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`;
}
