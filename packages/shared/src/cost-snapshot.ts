/**
 * "Não sabemos o custo desta venda" — a regra, num lugar só.
 *
 * `unitCostSnapshot` é nulo quando o custo não era conhecido no momento da
 * importação. Só que versões anteriores gravavam **zero** nesse caso, e zero
 * é um valor legítimo: significa "esta mercadoria não custou nada".
 *
 * Tratar zero como custo real produzia dois estragos ao mesmo tempo: o
 * produto aparecia com margem cheia, e o recálculo — que procura por nulo —
 * não via esses itens, então cadastrar o custo depois não corrigia nada. O
 * vendedor via o mesmo lucro inflado para sempre, sem aviso.
 *
 * A regra vale mais como função compartilhada do que repetida em cada
 * consulta: foi a repetição que deixou cinco lugares discordarem entre si.
 */
export function costIsUnknown(snapshot: unknown): boolean {
  if (snapshot === null || snapshot === undefined) return true;
  return Number(snapshot) === 0;
}
