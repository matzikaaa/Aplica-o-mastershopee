# Colocar em produção para clientes

Ordem que importa: cada item abaixo bloqueia o seguinte de fazer sentido.

## Variáveis obrigatórias na Vercel

Confira tudo de uma vez em `/api/health` — `problems` vazio significa que
nenhum bloqueador de configuração restou.

O diagnóstico completo exige estar logado, ou
`?token=<CRON_SECRET>` para conferir pelo terminal. Sem isso a rota devolve
só se a aplicação está de pé: o detalhe nomeia o host do banco e o que está
configurado, que é mapa de infraestrutura para quem estiver olhando.

| Variável | Para quê | Sem ela |
|---|---|---|
| `DATABASE_URL` | Neon, string **pooled** | Nada funciona |
| `NEXTAUTH_URL` | URL pública | Login recusa senha correta |
| `AUTH_SECRET` | Assinar sessão e state de OAuth | Login e conexão de loja quebram |
| `CREDENTIALS_ENCRYPTION_KEY` | Cifrar tokens (32 bytes base64) | Conectar marketplace cria a conta e falha ao salvar o token |
| `EMAIL_SERVER_HOST` e afins | E-mail transacional | Cadastro e recuperação de senha não chegam a ninguém |
| `STRIPE_SECRET_KEY` | Cobrança | Ninguém consegue pagar |
| `STRIPE_WEBHOOK_SECRET` | Confirmar pagamento | O plano nunca é ativado |
| `CRON_SECRET` | Autenticar o cron | Relatório diário e sync não disparam |
| `SHOPEE_*` | Integração | Sem dados de venda |
| `WHATSAPP_TEMPLATE_MORNING` | Template com resultado **e** estoque (7 parâmetros) | Cai no template de 6, e o estoque some da mensagem |
| `SENTRY_DSN` | Monitoramento (opcional) | Erro de cliente só aparece se ele reclamar |

## Stripe

1. Crie os produtos e preços no Stripe (mensal e anual de cada plano).
2. Grave os ids em `Plan.stripePriceIdMonthly` / `stripePriceIdYearly`.
3. Registre o webhook apontando para `https://SEU-DOMINIO/api/webhooks/stripe`
   com os eventos `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted` e
   `invoice.payment_failed`.
4. Copie o signing secret para `STRIPE_WEBHOOK_SECRET`.

O `change-plan` **nunca** grava o plano — quem grava é o webhook, depois do
pagamento. Se o webhook não estiver configurado, o cliente paga e não recebe
acesso; teste esse caminho antes de abrir para alguém.

## E-mail

Qualquer SMTP serve. Em produção, sem `EMAIL_SERVER_HOST` o envio agora
**lança erro** em vez de imprimir o link no console — o comportamento antigo
fazia o cadastro prometer um e-mail que não existia.

## Cron

`vercel.json` agenda `/api/cron/daily` às **09:30 UTC = 06:30 de Brasília**.
Numa passada só ele: sincroniza os pedidos de todas as contas conectadas,
verifica o estoque, e envia **uma** mensagem por workspace com o resultado do
dia anterior e os produtos a repor.

Estoque e resultado vão juntos de propósito: dois avisos na mesma manhã sobre
a mesma operação viram dois ruídos, e o segundo passa a ser ignorado junto
com o primeiro.

Como só há um disparo por dia, o horário que o vendedor escolhe em
Configurações funciona como "não me mande antes disso" — quem configurou
07:00 recebe no dia seguinte, não às 07:00 do mesmo dia. Horários abaixo de
06:30 recebem na hora do cron.

No plano Hobby a Vercel permite **um disparo por dia**. Para sincronização
mais frequente é preciso plano Pro, ou hospedar o worker.

## Antes de abrir para o primeiro cliente

```bash
pnpm db:check:demo    # nenhum dado de demonstração no banco de produção
pnpm db:backup        # cópia fora do Neon; o plano free retém 6 horas
```

E preencha os campos `[RAZÃO SOCIAL]`, `[CNPJ]`, `[ENDEREÇO]` e
`[E-MAIL DO ENCARREGADO]` em `/termos` e `/privacidade`. **Os dois textos
precisam de revisão por advogado** — descrevem corretamente o que o sistema
faz, o que não é o mesmo que estarem juridicamente corretos.

## Templates do WhatsApp

A Meta exige template aprovado para mensagem que a empresa inicia, e o número
de parâmetros é fixo no template. São dois:

- `WHATSAPP_TEMPLATE_DAILY_REPORT` — 6 parâmetros: loja, faturamento, lucro,
  margem, pedidos, ADS.
- `WHATSAPP_TEMPLATE_MORNING` — os 6 acima **mais** o placar de estoque
  (`"Estoque: 2 produto(s) para repor, 1 zerado(s)"`).

O combinado é o usado pelo cron. Sem ele configurado o envio cai no de 6: o
resultado chega igual, e o estoque fica no texto e na notificação do painel
em vez de o envio falhar.

## O que continua dependendo do worker

Reprocessamento de webhooks e sincronização de hora em hora. Alerta de
estoque saiu da lista: passou para o resumo da manhã. O cron cobre uma
sincronização por dia; o resto espera o worker ser hospedado (ver
`docs/worker/deploy.md`).
