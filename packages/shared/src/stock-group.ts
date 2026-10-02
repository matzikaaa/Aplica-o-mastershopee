/**
 * Adivinhar o agrupamento de estoque a partir do SKU.
 *
 * Um vendedor que anuncia a mesma mercadoria em embalagens diferentes quase
 * sempre codifica a quantidade no próprio SKU — LAVANDROLL-1, -3, -4, -10 —
 * porque é ele quem precisa se achar no painel da Shopee. Esse padrão é um
 * palpite bom o bastante para montar o grupo inteiro de uma vez e deixar a
 * pessoa só conferir, em vez de preencher dezenas de campos à mão.
 *
 * Palpite, nunca decisão: a sugestão vai para a tela e só vale depois de
 * confirmada. Aplicar sozinho um multiplicador errado estragaria o saldo de
 * um jeito silencioso e difícil de desfazer — um "-2" pode ser "2 unidades"
 * ou a segunda versão do anúncio, e só quem vende sabe qual.
 */

export interface SkuSugerido {
  sku: string;
  /** Raiz do SKU sem o sufixo numérico. */
  base: string;
  /** Quantas unidades-base esta venda consome, pelo sufixo. */
  unidades: number;
}

export interface GrupoSugerido {
  base: string;
  membros: SkuSugerido[];
}

/**
 * Separa um SKU em raiz e quantidade. Aceita os separadores que aparecem na
 * prática (`-`, `_`, espaço) e exige pelo menos uma letra na raiz, para que
 * um SKU puramente numérico não seja lido como "quantidade sem produto".
 */
export function lerSufixo(sku: string): SkuSugerido | null {
  const m = /^(.*[A-Za-z].*?)[-_ ]?(\d{1,3})$/.exec(sku.trim());
  if (!m) return null;

  const base = m[1]!.replace(/[-_ ]+$/, "");
  const unidades = Number(m[2]);
  if (!base || !Number.isFinite(unidades) || unidades < 1 || unidades > 999) return null;

  return { sku: sku.trim(), base, unidades };
}

/**
 * Agrupa uma lista de SKUs pelas raízes em comum.
 *
 * Só devolve grupos com dois ou mais membros: um SKU sozinho com sufixo não é
 * um grupo, é um nome. E nada de normalizar maiúsculas de forma destrutiva —
 * a comparação ignora caixa, mas o SKU devolvido é o original, porque é ele
 * que casa com o cadastro.
 */
export function sugerirGrupos(skus: string[]): GrupoSugerido[] {
  const porBase = new Map<string, SkuSugerido[]>();

  for (const sku of skus) {
    const lido = lerSufixo(sku);
    if (!lido) continue;
    const chave = lido.base.toUpperCase();
    const lista = porBase.get(chave) ?? [];
    lista.push(lido);
    porBase.set(chave, lista);
  }

  const grupos: GrupoSugerido[] = [];
  for (const [, membros] of porBase) {
    if (membros.length < 2) continue;
    membros.sort((a, b) => a.unidades - b.unidades);
    grupos.push({ base: membros[0]!.base, membros });
  }

  return grupos.sort((a, b) => a.base.localeCompare(b.base, "pt-BR"));
}
