import { ORDER_STATUS_LABELS, costIsUnknown, nomeDoMarketplace } from "@mastershopee/shared";
import Link from "next/link";
import Decimal from "decimal.js";
import { calcularPedido, prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import {
  LIMITE_PARA_FILTRO_DE_PREJUIZO,
  PROBLEMAS,
  SELECAO_DE_PEDIDO,
  lerFiltros,
  queryDosFiltros,
  temFiltroAlemDoPeriodo,
  whereDosFiltros,
} from "@/lib/order-filters";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Download, ShoppingCart } from "lucide-react";

const POR_PAGINA = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { workspace } = await requireWorkspace();
  const filtros = lerFiltros(searchParams);
  const where = whereDosFiltros(workspace.id, workspace.timezone, filtros);
  const pagina = Math.max(1, Math.floor(Number(searchParams.page ?? "1")) || 1);

  // Só oferece escolher marketplace quando há mais de um: com uma loja só, o
  // filtro é uma pergunta com uma resposta.
  const marketplacesComPedido = await prisma.order.groupBy({
    by: ["marketplace"],
    where: { workspaceId: workspace.id },
  });

  type Linha = Awaited<ReturnType<typeof buscarPagina>>[number];
  async function buscarPagina(skip: number, take: number) {
    return prisma.order.findMany({ where, select: SELECAO_DE_PEDIDO, orderBy: { orderedAt: "desc" }, skip, take });
  }

  let linhas: Linha[] = [];
  let total = 0;
  let perdaTotal: Decimal | null = null;
  let periodoGrandeDemais = false;

  if (filtros.problema === "prejuizo") {
    // O lucro sai do motor financeiro, não de uma conta em SQL: para filtrar
    // por ele é preciso calcular cada pedido do período.
    const candidatos = await prisma.order.count({ where });
    if (candidatos > LIMITE_PARA_FILTRO_DE_PREJUIZO) {
      periodoGrandeDemais = true;
    } else {
      const todos = await buscarPagina(0, candidatos);
      const comPrejuizo = todos
        .map((o) => ({ o, lucro: calcularPedido(o).netProfit.toDecimal() }))
        .filter((x) => x.lucro.isNegative());
      total = comPrejuizo.length;
      perdaTotal = comPrejuizo.reduce((acc, x) => acc.plus(x.lucro), new Decimal(0));
      linhas = comPrejuizo.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((x) => x.o);
    }
  } else {
    [linhas, total] = await Promise.all([
      buscarPagina((pagina - 1) * POR_PAGINA, POR_PAGINA),
      prisma.order.count({ where }),
    ]);
  }

  const filtrando = temFiltroAlemDoPeriodo(filtros);
  const totalDePaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-sm text-muted-foreground">
            {total} pedido(s){filtrando ? " com os filtros escolhidos" : " no período selecionado"}.
            {perdaTotal && total > 0 && (
              <span className="text-destructive"> Prejuízo somado: {formatCurrency(perdaTotal.abs().toFixed(2))}.</span>
            )}
          </p>
        </div>
        <DateRangePicker current={filtros.period} />
      </div>

      {/* GET puro: funciona sem JavaScript, o endereço guarda a busca e o
          botão Voltar do navegador desfaz um filtro como o vendedor espera. */}
      <form method="get" className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {filtros.period !== "last_30_days" && <input type="hidden" name="period" value={filtros.period} />}
        <Input
          name="q"
          defaultValue={filtros.q}
          placeholder="Buscar por nº do pedido, SKU ou produto"
          aria-label="Buscar pedidos"
          className="lg:min-w-56 lg:flex-1"
        />
        <Select name="status" defaultValue={filtros.status} aria-label="Status" className="lg:w-40">
          <option value="">Todos os status</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
        {marketplacesComPedido.length > 1 && (
          <Select name="marketplace" defaultValue={filtros.marketplace} aria-label="Marketplace" className="lg:w-44">
            <option value="">Todos os marketplaces</option>
            {marketplacesComPedido.map(({ marketplace }) => (
              <option key={marketplace} value={marketplace}>
                {nomeDoMarketplace(marketplace)}
              </option>
            ))}
          </Select>
        )}
        <Select name="problema" defaultValue={filtros.problema} aria-label="Mostrar só" className="lg:w-48">
          <option value="">Todos os pedidos</option>
          {Object.entries(PROBLEMAS).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
        <div className="flex shrink-0 gap-2">
          <button type="submit" className={buttonVariants()}>
            Filtrar
          </button>
          {filtrando && (
            <Link
              href={`/orders${queryDosFiltros({ ...filtros, q: "", status: "", marketplace: "", problema: "" })}`}
              className={buttonVariants({ variant: "ghost" })}
            >
              Limpar
            </Link>
          )}
          <a
            href={`/api/reports/orders${queryDosFiltros(filtros, { format: "csv" })}`}
            className={buttonVariants({ variant: "outline", className: "gap-1.5" })}
          >
            <Download className="h-3.5 w-3.5" /> Exportar
          </a>
        </div>
      </form>

      {periodoGrandeDemais ? (
        <EmptyState
          icon={ShoppingCart}
          title="Período grande demais para este filtro"
          description={`"Com prejuízo" calcula o lucro de cada pedido, e este período passa de ${LIMITE_PARA_FILTRO_DE_PREJUIZO.toLocaleString("pt-BR")} pedidos. Escolha um período menor.`}
        />
      ) : linhas.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={filtrando ? "Nenhum pedido com esses filtros" : "Nenhum pedido neste período"}
          description={
            filtrando
              ? "Tente outro termo de busca ou limpe os filtros."
              : "Pedidos sincronizados aparecerão aqui automaticamente."
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Data</TableHead>
                {marketplacesComPedido.length > 1 && <TableHead>Marketplace</TableHead>}
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((order) => {
                const lucro = calcularPedido(order).netProfit;
                // Custo desconhecido entra como zero no cálculo: o lucro
                // mostrado é maior que o real, e a linha precisa dizer isso.
                const semCusto = order.items.some((i) => costIsUnknown(i.unitCostSnapshot));
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                        {order.externalOrderId}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(order.orderedAt)}</TableCell>
                    {marketplacesComPedido.length > 1 && <TableCell>{nomeDoMarketplace(order.marketplace)}</TableCell>}
                    <TableCell className="text-right tabular-nums">{formatCurrency(order.grossAmount.toString())}</TableCell>
                    <TableCell className="text-right">
                      <span className={`tabular-nums ${lucro.isNegative() ? "text-destructive" : "text-success"}`}>
                        {formatCurrency(lucro.toFixed())}
                      </span>
                      {(semCusto || order.feesAreEstimated) && (
                        <span className="mt-0.5 flex justify-end gap-1">
                          {semCusto && (
                            <Badge variant="warning" title="Algum item deste pedido não tem custo cadastrado: o lucro real é menor.">
                              sem custo
                            </Badge>
                          )}
                          {order.feesAreEstimated && (
                            <Badge variant="warning" title="A Shopee ainda não liberou as taxas deste pedido: o lucro pode diminuir.">
                              taxas pendentes
                            </Badge>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {total > POR_PAGINA && !periodoGrandeDemais && (
        <div className="flex justify-center gap-2 text-sm">
          {pagina > 1 && (
            <Link
              href={`/orders${queryDosFiltros(filtros, { page: pagina - 1 })}`}
              className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted"
            >
              Anterior
            </Link>
          )}
          <span className="px-3 py-1.5 text-muted-foreground">
            Página {pagina} de {totalDePaginas}
          </span>
          {pagina < totalDePaginas && (
            <Link
              href={`/orders${queryDosFiltros(filtros, { page: pagina + 1 })}`}
              className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted"
            >
              Próxima
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
