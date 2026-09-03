# WhatsApp — o que fazer na Meta

O código já está pronto. O que falta são credenciais da Meta, que só você
pode obter. Dá para testar **hoje**, com o número de teste que a Meta fornece
de graça, antes de qualquer verificação de empresa.

---

## A regra que decide tudo

O WhatsApp Cloud API só aceita **texto livre** dentro da janela de 24 horas que
abre quando a pessoa manda mensagem para o número da empresa.

Tudo que o Mastershopee envia é iniciado pelo sistema — o resumo às 7h30, o
aviso de estoque baixo às 14h. Isso é *business-initiated* e exige um
**template aprovado**. Sem template, a mensagem é recusada com o erro 131047
("more than 24 hours have passed").

Por isso os alertas usam template e o texto livre só sobrou para resposta
dentro da janela.

---

## 1. Criar o app (10 minutos, sem verificação de empresa)

1. Acesse https://developers.facebook.com e crie uma conta de desenvolvedor
2. **Meus Apps → Criar app → Outro → Empresa**
3. No painel do app, adicione o produto **WhatsApp**
4. A Meta cria automaticamente uma **conta de teste** com:
   - um número de telefone de teste (remetente)
   - um token de acesso temporário (24 horas)
   - permissão para enviar a até **5 números de destino** que você cadastrar

5. Em **WhatsApp → Configuração da API**, cadastre o seu celular como
   destinatário e confirme o código que chegar

Anote: **Identificação do número de telefone** (`WHATSAPP_PHONE_NUMBER_ID`) e
**Identificação da conta do WhatsApp Business** (`WHATSAPP_BUSINESS_ACCOUNT_ID`).

## 2. Criar os templates

Em **WhatsApp → Gerenciador do WhatsApp → Modelos de mensagem → Criar modelo**.

Aprovação costuma sair em minutos para templates utilitários.

### `mastershopee_morning` — **é este que o cron usa**

O resumo da manhã traz resultado e estoque na mesma mensagem. São 7
variáveis: as 6 do resultado mais o placar de estoque.

- Categoria: **Utilidade**
- Idioma: **Português (BR)**
- Corpo:

```
Resultado de ontem em {{1}}:

Faturamento: {{2}}
Lucro líquido: {{3}}
Margem: {{4}}
Pedidos: {{5}}
ADS: {{6}}

{{7}}
```

- Exemplos para aprovação: `Archi Store`, `R$ 1.234,56`, `R$ 312,45`,
  `25,31%`, `48`, `R$ 120,00`, `Estoque: 2 produto(s) para repor, 1 zerado(s)`

O sétimo parâmetro é uma linha só porque a Meta recusa quebra de linha
dentro de variável. A lista dos produtos vai no corpo da mensagem de texto e
na notificação do painel.

### `mastershopee_daily_report` — opcional, 6 variáveis

Só o resultado, sem estoque. É o que o botão "Enviar relatório de ontem" usa
e a reserva do cron quando o de 7 não está configurado. Se você só vai usar o
resumo da manhã, pode pular este.

- Categoria: **Utilidade**
- Idioma: **Português (BR)**
- Corpo:

```
Resultado de ontem em {{1}}:

Faturamento: {{2}}
Lucro líquido: {{3}}
Margem: {{4}}
Pedidos: {{5}}
ADS: {{6}}
```

- Exemplos para aprovação: `Archi Store`, `R$ 1.234,56`, `R$ 312,45`,
  `25,31%`, `48`, `R$ 120,00`

### `mastershopee_low_stock` — opcional

Alerta de estoque isolado, por produto. Desde que estoque passou a viajar no
resumo da manhã, este só é usado pelo worker, que não está hospedado. Pode
pular enquanto for assim.

- Categoria: **Utilidade**
- Idioma: **Português (BR)**
- Corpo:

```
Estoque baixo: {{1}} ({{2}})

Restam {{3}} unidades, cobertura de {{4}}.
Fornecedor: {{5}}, prazo de {{6}} dias.

Faça o pedido agora para não ficar sem.
```

- Exemplos: `Saco Lixo 10L Lavanda`, `LAVANDROLL-1`, `18`, `4,2 dias`,
  `Fornecedor X`, `5`

> ⚠️ Variáveis de template **não aceitam quebra de linha, tabulação nem
> sequências de 4+ espaços**. O código já limpa isso antes de enviar
> (`sanitizeTemplateParam`), mas vale saber ao escrever o modelo.

## 3. Token permanente

O token da tela inicial expira em 24 horas. Para produção:

1. **Configurações do Negócio → Usuários → Usuários do sistema**
2. Crie um usuário do sistema com papel **Administrador**
3. **Adicionar ativos** → o app e a conta do WhatsApp Business
4. **Gerar novo token** com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`
5. Escolha **Nunca expira**

## 4. Preencher o `.env`

```
WHATSAPP_PHONE_NUMBER_ID=<identificação do número>
WHATSAPP_BUSINESS_ACCOUNT_ID=<identificação da conta>
WHATSAPP_ACCESS_TOKEN=<token do usuário do sistema>
WHATSAPP_TEMPLATE_MORNING=mastershopee_morning
WHATSAPP_TEMPLATE_DAILY_REPORT=mastershopee_daily_report
WHATSAPP_TEMPLATE_LOW_STOCK=mastershopee_low_stock
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
CRON_SECRET=<32 bytes em base64, o mesmo formato da chave de credenciais>
```

Na Vercel: **Settings → Environment Variables**, e **redeploy** — variável de
ambiente só é lida na inicialização, então salvar sem redeploy não muda nada.

## 5. Verificar dentro do app

**Configurações → WhatsApp** → salve o número → **Enviar mensagem de teste**.

A configuração só é marcada como verificada se a Meta aceitar a mensagem de
verdade. Enquanto não estiver verificada, **nenhum alerta é enviado** — nem o
resumo diário nem o de estoque. Isso é proposital: um número salvo mas não
testado é uma configuração que parece pronta e não entrega nada.

## 6. Conferir o conteúdo antes de esperar a manhã

**Configurações → WhatsApp → Enviar relatório de ontem** manda o relatório
com os números reais, pelo mesmo compositor que o cron usa. O "Enviar
mensagem de teste" manda zeros de propósito: ele prova que a mensagem sai,
não que o conteúdo está certo.

## 7. O disparo automático

Quem dispara é o Cron da Vercel, configurado em `apps/web/vercel.json` para
**09:30 UTC = 06:30 de Brasília**. Numa passada só ele sincroniza os pedidos,
verifica o estoque e envia a mensagem.

Precisa de `CRON_SECRET` configurado — sem ele a rota recusa tudo, em vez de
ficar aberta na internet disparando mensagens.

Para testar sem esperar: **Vercel → Settings → Cron Jobs → Run** dispara na
hora. Ou pelo terminal, com o mesmo segredo:

```powershell
curl -H "Authorization: Bearer $env:CRON_SECRET" https://SEU-DOMINIO/api/cron/daily
```

No plano Hobby a Vercel permite **um disparo por dia**. O horário que o
vendedor escolhe em Configurações vira "não me mande antes disso": quem
configurar 07:00 recebe no dia seguinte, não às 07:00 do mesmo dia.

---

## Erros comuns e o que significam

| Erro da Meta | Causa | Correção |
| --- | --- | --- |
| `131047` — more than 24 hours have passed | Enviou texto livre fora da janela | Cadastre e configure os templates |
| `132001` — template name does not exist | Nome ou idioma errado no `.env` | Confira o nome exato e `pt_BR` |
| `131030` — recipient not in allowed list | Número de teste só envia para destinatários cadastrados | Cadastre o celular na tela de configuração da API |
| `190` — access token expired | Está usando o token de 24h | Gere o token do usuário do sistema (passo 3) |
| `133010` — phone number not registered | Número não concluiu o registro | Termine o registro no Gerenciador |

O app mostra a mensagem da Meta na íntegra na tela de teste, sem parafrasear —
cada uma dessas aponta para uma correção diferente.

## Limites e custo

- **Conversas de utilidade**: as primeiras 1.000/mês são gratuitas
- Depois, cerca de R$ 0,04 por conversa de 24h no Brasil
- Um resumo diário para um número = ~30 conversas/mês, dentro do gratuito

## Quando sair do número de teste

O número de teste envia para no máximo 5 destinatários e não serve para
clientes. Para usar um número próprio é preciso **verificação da empresa**
(CNPJ, comprovante de endereço), que leva alguns dias. Para o uso atual —
alertas para o próprio CEO — o número de teste basta.
