import Link from "next/link";
import type { VendaSemCusto } from "@mastershopee/database";
import { formatDate } from "@/lib/utils";

/**
 * Os SKUs por trás do aviso de "itens sem custo", nomeados e com o motivo.
 *
 * Um contador sozinho não é acionável: numa tela em que todo produto visível
 * mostra custo preenchido, "3 itens sem custo" só levanta a pergunta "quais?".
 * E aviso sem ação possível é aviso que se aprende a ignorar — que é o oposto
 * do que um indicador de qualidade de dado existe para fazer.
 */
export function UnknownCostList({ vendas }: { vendas: VendaSemCusto[] }) {
  if (vendas.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-warning/30">
      <table className="w-full text-sm">
        <thead className="bg-warning/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">SKU sem custo na venda</th>
            <th className="px-3 py-2 text-right font-medium">Itens</th>
            <th className="px-3 py-2 font-medium">Venda mais antiga</th>
            <th className="px-3 py-2 font-medium">Por quê</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {vendas.map((v) => (
            <tr key={v.productId || v.sku}>
              <td className="px-3 py-2">
                <p className="font-medium">{v.nome}</p>
                <p className="font-mono text-xs text-muted-foreground">{v.sku}</p>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{v.itens}</td>
              <td className="px-3 py-2 tabular-nums">{formatDate(v.primeiraVenda)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {v.motivo === "sem-custo-cadastrado" ? (
                  v.productId ? (
                    <>
                      Nenhum custo cadastrado.{" "}
                      <Link href={`/costs#${v.sku}`} className="font-medium text-primary hover:underline">
                        Cadastrar
                      </Link>
                    </>
                  ) : (
                    // SKU em branco na resposta da Shopee: não há produto onde
                    // pendurar custo, então "cadastrar" não é conselho honesto.
                    "A Shopee devolveu este item sem SKU — corrija o anúncio e importe de novo."
                  )
                ) : (
                  <>
                    O custo vale desde {formatDate(v.custoDesde!)}, depois desta venda. Use{" "}
                    <strong>Aplicar ao histórico</strong>.
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
