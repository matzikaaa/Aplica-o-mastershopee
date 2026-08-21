# Exportações da Shopee — formatos reais

Levantado a partir de exportações reais do Seller Centre brasileiro em
agosto/2026. Serve de referência para os aliases de coluna em
`packages/shared/src/import.ts`.

Os arquivos originais **não** estão versionados: a exportação de pedidos
carrega nome, CPF, telefone e endereço dos compradores, e commitar isso
deixaria dados pessoais de terceiros no histórico do git para sempre. Aqui
fica só o esqueleto das colunas.

---

## 1. Pedidos

Dois exports diferentes, mesmo layout de coluna:

- **`Order.toship.*.xlsx`** — só os pedidos com status "A Enviar" no momento
  da exportação. 63 colunas. Não serve para histórico: escolher um mês passado
  devolve um arquivo só com cabeçalho.
- **`Order.all.*.xlsx`** — todos os pedidos do período. 64 colunas (acrescenta
  `Cancelar Motivo` na quarta posição). **É este que serve para histórico.**

Uma aba, chamada `orders`. Cabeçalho na primeira linha. **Uma linha por item
de pedido** — pedidos com vários itens repetem o número do pedido.

### Colunas

| Coluna | Campo no Mastershopee | Observação |
| --- | --- | --- |
| `ID do pedido` | `externalOrderId` | ex.: `260821UCHMVRK5` |
| `Status do pedido` | `status` | `A Enviar` → `PAID` (pago, ainda não despachado) |
| `Data de criação do pedido` | `orderedAt` | formato `2026-08-20 13:06` |
| `Data prevista de envio` | — | **não usar como data do pedido** |
| `Nº de referência do SKU principal` | — | vem **em branco** na maioria das linhas |
| `Número de referência SKU` | `sku` | é o SKU da variação, o que está preenchido |
| `Nome do Produto` | nome do produto | |
| `Nome da variação` | — | ex.: `2 Unidades` |
| `Quantidade` | `quantity` | |
| `Preço original` / `Preço acordado` | — | preço unitário antes/depois de desconto |
| `Subtotal do produto` | `grossAmount` | receita do item |
| `Valor Total` | — | inclui frete pago pelo comprador; **não é sua receita** |
| `Taxa de comissão bruta` | `commissionAmount` | |
| `Taxa de serviço bruta` | `marketplaceFeeAmount` | |
| `Taxa de transação` | — | veio `0,00` nas amostras |
| `Taxa de envio pagas pelo comprador` | — | dinheiro do comprador, não custo seu |
| `Desconto de Frete Aproximado` | — | subsídio da Shopee, não custo seu |
| `Total global` | — | líquido estimado pela Shopee |

Colunas com dados pessoais, ignoradas na importação: `Nome de usuário
(comprador)`, `Nome do destinatário`, `Telefone`, `CPF do Comprador`,
`Endereço de entrega`, `Cidade`, `Bairro`, `UF`, `CEP`, `Observação do
comprador`.

### Valores de `Status do pedido` vistos em 2.977 linhas reais

| Status na planilha | Vira | Ocorrências |
| --- | --- | --- |
| `Concluído` | `DELIVERED` | 1.834 |
| `Cancelado` | `CANCELED` | 423 |
| `Entregue` | `DELIVERED` | 275 |
| `Enviado` | `SHIPPED` | 217 |
| `O comprador pode pedir uma devolução até <data>` | `DELIVERED` | 194 |
| `A Enviar` | `PAID` | 27 |
| `Não pago` | `CREATED` | 6 |
| `Pedido Recebido` | `PAID` | 1 |

> ⚠️ `O comprador pode pedir uma devolução até <data>` **não é** uma devolução:
> é um pedido entregue dentro do prazo em que o comprador ainda poderia abrir
> uma. Classificar como devolvido apagaria 194 vendas reais.

### Armadilhas confirmadas

- **Nomes de coluna repetidos**: `Desconto do vendedor` aparece duas vezes e
  `Cidade` também. O assistente sufixa a repetição (`Cidade (2)`) para que uma
  não sobrescreva a outra.
- **`Cancelado` representa 13,4% do faturamento bruto.** Todo lugar que soma
  dinheiro filtra por `NON_REVENUE_ORDER_STATUSES`; a lista de pedidos não
  filtra, de propósito, para o cancelamento continuar visível.
- **SKUs quase iguais existem.** Nas amostras aparecem `LAVANDROLL-1` e
  `LAVNDROLL-1` (sem o segundo A) como produtos distintos, cadastrados assim
  na própria Shopee. O app não junta os dois sozinho — só quem vende sabe se
  são o mesmo produto. Em **Custos › Unificar SKUs** o operador escolhe qual
  fica; o histórico dos dois passa para ele e o código que sumiu vira apelido,
  para uma reimportação da mesma planilha não recriar a duplicata.
- **Não há coluna de frete pago pelo vendedor.** Todas as colunas de frete são
  dinheiro do comprador ou subsídio da Shopee. O campo fica sem mapeamento de
  propósito.

---

## 2. Anúncios — `DadosGeraisdeAnúnciosShopee<período>.csv`

CSV com BOM, separado por vírgula. **Sete linhas de preâmbulo** antes do
cabeçalho real:

```
Relatório de Todos os Anúncios CPC - Shopee Brasil
Nome de Usuário,<usuário>
Nome da loja,<loja>
ID da Loja,<id>
Data de Criação do Relatório,20/08/2026 19:36
Período,01/08/2026 - 20/08/2026
<linha em branco>
#,Nome do Anúncio,Status,...      ← cabeçalho real
```

`detectHeaderRow` resolve isso escolhendo a linha mais larga do topo.

### Colunas aproveitáveis

| Coluna | Campo |
| --- | --- |
| `Nome do Anúncio` | `campaignName` |
| `Despesas` | `spend` |
| `GMV` | `attributedRevenue` |
| `Conversões` | `orders` |
| `Cliques` | `clicks` |
| `Impressões` | `impressions` |

### Por que este relatório não importa hoje

Ele é um **total do período**, uma linha por campanha. `AdSpend` é diário
(`@@unique([campanha, data])`), e as únicas datas do arquivo são `Data de
Início` e `Data de Encerramento` — quando a campanha começou, não quando o
dinheiro foi gasto. Distribuir o total do período pelos dias seria inventar
número, então o campo `Data` é `strict` e fica sem mapeamento: a importação
trava com "Relacione as colunas obrigatórias: Data" em vez de gravar um gasto
falso.

**O que exportar no lugar:** um relatório de anúncios com granularidade
diária — uma linha por campanha por dia, com uma coluna de data.

---

## 3. Conferência de importação

Maio a agosto de 2026 (`Order.all`), importado pelas rotas
`/api/import/skus` e `/api/import/orders`:

| | Planilha | Importado |
| --- | --- | --- |
| Linhas | 2.977 | 2.977 itens, 0 ignorados |
| Pedidos distintos | 2.964 | 2.964 |
| Pedidos com mais de um item | 12 | 12 |
| SKUs distintos | 20 | 20 produtos criados |
| Soma de `Subtotal do produto` | 66.036,39 | 66.036,39 |
| Soma de `Taxa de comissão bruta` | 10.265,20 | 10.265,20 |
| Soma de `Taxa de serviço bruta` | 11.592,10 | 11.592,10 |

Descontando cancelados, devolvidos e reembolsados: **R$ 57.170,55** em
2.543 pedidos — R$ 8.865,84 a menos que o bruto.
