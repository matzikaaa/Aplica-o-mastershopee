# Shopee — sair do Test e ir para Live

## O que o Live exige, e por que a ordem importa

A Shopee revisa o app antes de liberar credenciais Live. A revisão é feita por
uma pessoa que **abre a sua URL** e confere se o app existe, funciona e tem
política de privacidade e termos acessíveis.

Isso significa que **o deploy vem primeiro**. Uma URL de ngrok não serve: ela
muda a cada reinício, e se o revisor abrir depois que você desligou a máquina,
o app está fora do ar e a revisão é reprovada.

Ordem obrigatória:

1. Deploy num domínio estável (Vercel + Neon — ver `DEPLOYMENT.md`)
2. Atualizar o redirect no console da Shopee para o domínio novo
3. Submeter o Go-Live
4. Trocar as credenciais no `.env` quando aprovar

---

## 1. Antes de submeter

Confira que estas URLs abrem em janela anônima, sem login:

| O que | URL |
| --- | --- |
| Página inicial | `https://SEU-DOMINIO/` |
| Política de privacidade | `https://SEU-DOMINIO/privacidade` |
| Termos de uso | `https://SEU-DOMINIO/termos` |
| Callback do OAuth | `https://SEU-DOMINIO/api/integrations/shopee/callback` |

O callback não precisa "funcionar" sozinho — só existir e responder. As três
primeiras o revisor lê.

> ⚠️ Os textos de `/termos` e `/privacidade` foram escritos como base técnica,
> não por advogado. Antes de expor publicamente com CNPJ e dados de terceiros,
> vale uma revisão jurídica — principalmente as partes de LGPD, já que o app
> processa nome, CPF e endereço de compradores vindos das exportações.

## 2. A conta de teste que a Shopee pede

O formulário pede URL, usuário e senha — o revisor entra e olha.

**Não passe a sua conta real.** Esse login expõe nome, CPF e endereço dos seus
compradores, vindos das exportações, para um terceiro. E uma conta vazia faz o
revisor ver um app sem nada e reprovar.

Use os dados demo, que já vêm marcados `[DEMO]` e não se passam por reais.
No banco de **produção**, depois do deploy:

```bash
pnpm db:seed:demo
pnpm db:set-password demo@mastershopee.app 'uma-senha-forte-e-unica'
```

A troca de senha não é opcional: `demo12345` está publicada no README deste
repositório, que é público. Sem trocar, qualquer pessoa que leia o repositório
entra na conta que você deu à Shopee.

Quando a revisão terminar, `pnpm db:purge:demo` remove tudo.

## 3. O formulário de Go-Live

No console (open.shopee.com) → seu app → **Go Live**.

O que costuma ser pedido, e o que responder:

**Nome e descrição do app**
> Mastershopee — central financeira para vendedores de marketplace. Calcula o
> lucro líquido real por pedido e por produto, descontando comissões, taxas de
> serviço, custo do produto, frete e gastos com anúncios.

**Quais APIs usa e por quê**
| API | Uso |
| --- | --- |
| `auth_partner` / `token/get` | Autorização da loja pelo próprio vendedor |
| `order/get_order_list` | Puxar pedidos para calcular receita e taxas |
| `order/get_order_detail` | Itens, comissão e taxa de serviço por pedido |
| `product/get_item_list` | Catálogo, para casar SKU com o custo cadastrado |

Peça só o que usa. Pedir escopo a mais atrasa a revisão.

**Como os dados são protegidos**
> Dados de cada vendedor ficam isolados por workspace, com todo acesso
> verificando a associação do usuário. Tokens de marketplace são gravados
> cifrados. O acesso é por HTTPS.

**Público-alvo**
> Vendedores brasileiros da Shopee, uso próprio da própria loja.

## 4. Depois de aprovado

A Shopee emite um **partner_id e partner_key novos**, do ambiente Live. Os de
teste continuam existindo e **não funcionam** contra o host Live — a troca é
completa:

```
SHOPEE_PARTNER_ID=<novo, do Live>
SHOPEE_PARTNER_KEY=<novo, do Live>
SHOPEE_ENV=live
SHOPEE_REDIRECT_URL=https://SEU-DOMINIO/api/integrations/shopee/callback
```

Reinicie o servidor e vá em **Integrações → Verificar credenciais** antes de
tentar conectar a loja. Esse botão pergunta direto à Shopee se a assinatura é
aceita, e devolve o erro dela sem parafrasear — resolve em segundos o que, no
meio do redirect de autorização, levaria horas.

---

## Sobre o `error_sign` que travou o ambiente de teste

A fórmula da assinatura no código confere com a documentada:

```
sign = HMAC-SHA256(partner_id + api_path + timestamp, partner_key) em hex
```

Isso foi verificado recalculando à mão. As causas que restam, em ordem de
probabilidade:

1. **Credenciais do ambiente trocado** — partner_key de Test contra host Live,
   ou o contrário. O diagnóstico aponta isso explicitamente.
2. **Chave colada incompleta** — o partner_key é longo e a caixa do console
   corta visualmente. O diagnóstico mostra o tamanho para conferir.
3. **Relógio fora do horário** — a assinatura inclui o timestamp e a Shopee
   recusa fora de ~5 minutos. Sincronize o relógio do Windows.
4. **Problema no lado da Shopee** — foi o que pareceu no ambiente de teste, já
   que a criação da Test Account também falhava. O ticket aberto cobre isso.

Com as credenciais Live novas, vale rodar o diagnóstico **antes** de concluir
que o problema persiste: são credenciais diferentes, emitidas por outro fluxo.

## Limites da API que valem saber

- Janela de consulta de pedidos: **15 dias por chamada** (o código já respeita)
- Token de acesso expira em **4 horas**; o refresh token dura 30 dias
- Se ninguém renovar por 30 dias, o vendedor precisa autorizar de novo
- A **API de Ads é separada** e exige aprovação adicional — por isso o gasto
  com anúncio é lançado à mão hoje
