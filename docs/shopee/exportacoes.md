# Exportações da Shopee — formatos reais

Levantado a partir de exportações reais do Seller Centre brasileiro em
agosto/2026. Serve de referência para os aliases de coluna em
`packages/shared/src/import.ts`.

Os arquivos originais **não** estão versionados: a exportação de pedidos
carrega nome, CPF, telefone e endereço dos compradores, e commitar isso
deixaria dados pessoais de terceiros no histórico do git para sempre. Aqui
fica só o esqueleto das colunas.

---

## 1. Pedidos — `Order.toship.AAAAMMDD_AAAAMMDD.xlsx`

Uma aba, chamada `orders`. Cabeçalho na primeira linha. **Uma linha por item
de pedido** — pedidos com vários itens repetem o número do pedido.

> ⚠️ **Este export traz apenas os pedidos com status "A Enviar" no momento da
> exportação.** Escolher um período passado não traz o histórico daquele mês:
> o arquivo sai só com o cabeçalho. Para histórico, exporte pela lista de
> pedidos com o filtro de status em "Todos"/"Concluído".

### Colunas (63 no total)

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

### Armadilhas confirmadas

- **Nomes de coluna repetidos**: `Desconto do vendedor` aparece duas vezes e
  `Cidade` também. O assistente sufixa a repetição (`Cidade (2)`) para que uma
  não sobrescreva a outra.
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

## 3. Conferência de importação (agosto/2026)

17 linhas de pedido reais, importadas pelas rotas `/api/import/skus` e
`/api/import/orders`:

| | Planilha | Importado |
| --- | --- | --- |
| Linhas | 17 | 17 pedidos, 0 ignorados |
| SKUs distintos | 5 | 5 produtos criados |
| Soma de `Subtotal do produto` | 337,27 | 337,27 |
| Soma de `Taxa de comissão bruta` | 60,73 | 60,73 |
| Soma de `Taxa de serviço bruta` | 74,75 | 74,75 |
