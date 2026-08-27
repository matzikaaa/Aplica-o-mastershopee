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
# leia a seção sobre error_sign antes de mexer neste
SHOPEE_KEY_ENCODING=raw
```

Reinicie o servidor e vá em **Integrações → Verificar credenciais** antes de
tentar conectar a loja. Esse botão pergunta direto à Shopee se a assinatura é
aceita, e devolve o erro dela sem parafrasear — resolve em segundos o que, no
meio do redirect de autorização, levaria horas.

---

## Sobre o `error_sign` (teste **e** Live)

A fórmula da assinatura no código confere com a documentada:

```
sign = HMAC-SHA256(partner_id + api_path + timestamp, partner_key) em hex
```

Isso foi verificado recalculando à mão. O que a documentação **não** diz é em
que formato a `partner_key` sai do console. Ela é exibida como `shpk` seguido
de 60 caracteres hexadecimais — e esses 60 hexadecimais decodificam para
exatamente 30 bytes ASCII imprimíveis. Isso não é o que bytes aleatórios
parecem, então há duas leituras plausíveis da mesma chave: a string exibida
*é* a chave, ou a string exibida é a impressão hexadecimal da chave.

Assinar com a leitura errada devolve `error_sign` — o mesmo erro de ambiente
trocado, chave truncada e relógio fora de hora. Por isso o diagnóstico não
escolhe uma leitura: ele **pergunta à Shopee**. Em **Integrações → Verificar
credenciais** (`POST /api/integrations/shopee/diagnose`) ele assina a mesma
chamada com cada leitura e reporta qual passou:

```json
{
  "keyEncoding": "raw",
  "acceptedKeyEncoding": "hex-decoded",
  "signAttempts": [
    { "encoding": "raw",         "keyByteLength": 64, "signAccepted": false },
    { "encoding": "stripped",    "keyByteLength": 60, "signAccepted": false },
    { "encoding": "hex-decoded", "keyByteLength": 30, "signAccepted": true  }
  ]
}
```

Quando `acceptedKeyEncoding` vier diferente de `keyEncoding`, ponha o valor
aceito em `SHOPEE_KEY_ENCODING` (na Vercel: Settings → Environment Variables)
e faça o redeploy. É o que faz o resto da aplicação — OAuth, sync, webhook —
assinar igual ao que passou no teste. Enquanto os dois não baterem, o
diagnóstico **não** responde `ok: true`, de propósito: dizer que está tudo
certo com o sync quebrado seria mentira.

O relatório informa só o tamanho em bytes de cada leitura, nunca a chave.

Se **nenhuma** leitura passar, a codificação não é o problema. Sobram:

1. **Credenciais do ambiente trocado** — partner_key de Test contra host Live,
   ou o contrário. O diagnóstico aponta isso explicitamente.
2. **Chave colada incompleta** — o partner_key é longo e a caixa do console
   corta visualmente. O diagnóstico mostra o tamanho para conferir.
3. **Relógio fora do horário** — a assinatura inclui o timestamp e a Shopee
   recusa fora de ~5 minutos. Sincronize o relógio do Windows.
4. **IP não liberado** — o console tem allowlist de IP por app. A Vercel não
   dá IP fixo no plano padrão; se a Shopee exigir, é preciso sair por um IP
   estático (o worker no Railway, ou um proxy).

## Limites da API que valem saber

- Janela de consulta de pedidos: **15 dias por chamada** (o código já respeita)
- Token de acesso expira em **4 horas**; o refresh token dura 30 dias
- Se ninguém renovar por 30 dias, o vendedor precisa autorizar de novo
- A **API de Ads é separada** e exige aprovação adicional — por isso o gasto
  com anúncio é lançado à mão hoje
