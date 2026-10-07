# Avisos em tempo real da Shopee (Push Mechanism)

Com o push configurado, um pedido novo aparece no painel em segundos. Sem ele,
aparece na próxima rodada — ao abrir o painel ou na sincronização da manhã.

**O push não substitui as varreduras.** Entrega falha, deploy acontece no
momento errado, há janela de manutenção. Um sistema que confia só no push
descobre o buraco quando o vendedor reclama de um pedido que nunca apareceu.
Aqui o push é a via rápida; a sincronização periódica é a rede.

## 1. Descobrir a URL

Em **Integrações → Situação**, o painel mostra a URL exata. Ela é
`https://SEU-APP.vercel.app/api/webhooks/shopee`.

## O que a Shopee garante (e o que não garante)

A documentação de cada mecanismo declara isto, e o desenho daqui segue os
quatro pontos:

| Propriedade | Valor | O que isso obriga |
| --- | --- | --- |
| Time Out | **3s** | a rota confirma antes de trabalhar; buscar o pedido primeiro estouraria o teto |
| Retry | 300s, 1800s, 10800s | estourar não perde o aviso: traz o mesmo três vezes |
| Can Repeated Same Message | **Yes** | todo push é idempotente aqui |
| Sequence Guaranteed | **No** | o push é só gatilho; o estado vem sempre da API |

O último é o que mais importa: a aplicação **nunca acredita no conteúdo do
push**. Ela usa o aviso para ir buscar o pedido na API. Dois avisos do mesmo
pedido, em qualquer ordem, levam ao mesmo resultado — e um mecanismo novo que
a Shopee lançar amanhã já funciona, desde que cite um número de pedido.

## 2. Cadastrar no console da Shopee

**Console → seu app → Push Mechanism → Set Push**, aba **Live Push Setting**.
Quatro campos, nesta ordem — a verificação depende dela.

**1. Get Live Push** — ligue.

**2. Live Push Partner Key** → botão **Generate**.

> **Esta chave não é o `SHOPEE_PARTNER_KEY`.** Os pushes são assinados com ela;
> os da API, com a outra. Usar a de API produz assinatura que nunca bate, com
> as duas chaves visivelmente corretas em seus lugares.
>
> Gere, copie e configure na Vercel como **`SHOPEE_PUSH_PARTNER_KEY`** —
> **antes** de clicar em Verify. A verificação manda um push de teste, e sem a
> chave certa ele é recusado.

**3. Live Call Back URL** — a URL que aparece em **Integrações → Situação**:
`https://SEU-APP.vercel.app/api/webhooks/shopee`. Depois clique em **Verify**.

> *"Failed Verification! ... the response code we get from this callback_url is
> not 2xx"* quer dizer que a Shopee não recebeu 2xx. Causas, nesta ordem:
> URL vazia ou com erro de digitação; o deploy ainda não promovido; ou a
> aplicação no ar sendo anterior a esta versão.

**4. The Deployment Service Area** — onde a sua função roda, não onde você
mora. Veja em **Vercel → Settings → Functions → Region** (o padrão é
`iad1`, Washington D.C. = **US East**) e escolha a correspondente. Verify.

**5. Live Push Settings** — a lista de mecanismos. Ligue:

## 3. Conferir

Volte em **Integrações → Situação**. A linha de push diz uma de três coisas:

| O que aparece | O que significa |
| --- | --- |
| `Avisos em tempo real ativos — N recebidos (order_status_push: N)` | funcionando, e diz qual mecanismo está chegando |
| `N aviso(s) recusados por assinatura` + razão | chegou e foi recusado — veja abaixo |
| `Avisos em tempo real ainda não chegaram` | a URL não foi cadastrada, ou nada aconteceu na loja ainda |

Se faltar a `SHOPEE_PUSH_PARTNER_KEY`, a linha diz isso antes de o primeiro
push chegar — não é preciso provocar uma venda para descobrir.

## Se os avisos forem recusados

A assinatura do push é HMAC-SHA256 de `URL|corpo`, com a **Live Push Partner
Key**. A
mensagem na tela traz os primeiros caracteres da assinatura esperada e da
recebida, mais a URL usada como base. Três causas produzem o mesmo sintoma:

1. **`SHOPEE_PUSH_PARTNER_KEY` ausente ou diferente da gerada no console.** A
   mensagem na tela diz quando a aplicação caiu na chave da API por falta
   dela.
2. **URL diferente da cadastrada.** É a mais comum. A base da assinatura é a
   string exata que está no console — se lá está `https://meudominio.com.br/...`
   e o app calcula com `https://app.vercel.app/...`, nunca bate. Configure
   `SHOPEE_PUSH_URL` na Vercel com a URL exata do console.
3. **Ambiente trocado** — chave de Test com URL cadastrada em Live.

Nenhum push recusado é processado, e todos ficam gravados com a razão — então
dá para corrigir e conferir sem precisar provocar uma venda de verdade.

## Desautorização com outro código

O único tratamento que depende do número do mecanismo é o de revogação de
acesso, porque esse push não cita pedido nenhum e não há como deduzi-lo do
conteúdo. O padrão é `2`, que é o código de `shop_authorization_canceled_push` — ou
seja, não há nada a configurar. A variável existe para o caso de a Shopee
renumerar ou de outro mecanismo passar a significar o mesmo:

```
SHOPEE_PUSH_CODES_DEAUTH=2,16
```

Errar esse número desliga apenas o aviso de revogação. **Nenhum pedido deixa
de entrar por causa dele.**
