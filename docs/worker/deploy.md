# Subir o worker

A Vercel não mantém processo em execução, então `apps/worker` precisa de outro
host. Sem ele o site funciona — login, painel, importação por planilha,
estoque, calculadora — mas nada acontece sozinho:

- pedidos não são importados das APIs de marketplace;
- métricas diárias não são recalculadas fora de uma importação;
- alerta de estoque baixo e resumo diário no WhatsApp não disparam.

Há um `apps/worker/Dockerfile` pronto. Ele é construído **a partir da raiz do
repositório**, não da pasta do worker, porque o worker depende dos pacotes do
workspace que ficam fora dela.

---

## Railway (mais simples)

1. https://railway.app → entre com o GitHub → **New Project → Deploy from GitHub repo**
2. Escolha o repositório e a branch
3. Em **Settings → Build**:
   - **Builder**: `Dockerfile`
   - **Dockerfile Path**: `apps/worker/Dockerfile`
   - **Root Directory**: deixe vazio (a raiz — o build precisa dela)
4. Em **Variables**, adicione:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | a string **direta** do Neon (sem `-pooler`) |
| `REDIS_URL` | a mesma do Upstash usada pelo site |
| `CREDENTIALS_ENCRYPTION_KEY` | **exatamente** a mesma da Vercel |
| `NODE_ENV` | `production` |
| `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` / `SHOPEE_ENV` | as mesmas da Vercel |
| `WHATSAPP_*` | as mesmas da Vercel, se já configuradas |

5. **Deploy**

> **A `CREDENTIALS_ENCRYPTION_KEY` tem que ser idêntica à da Vercel.** É ela
> que decifra os tokens de marketplace gravados pelo site. Chaves diferentes e
> o worker não consegue ler nenhuma conta conectada — falha silenciosa, sem
> erro óbvio.

> **Aqui use a string direta, não a pooled.** O worker é um processo só, com
> um punhado de conexões estáveis; o pooler do Neon serve ao caso oposto,
> muitas conexões curtas de funções serverless.

## Render

Mesma ideia: **New → Background Worker**, runtime **Docker**, Dockerfile Path
`apps/worker/Dockerfile`, Root Directory vazio, e as mesmas variáveis.

O plano gratuito do Render hiberna serviços inativos, o que atrasa alertas.
Para o resumo diário chegar no horário, use um plano que não hiberne.

## Fly.io

```bash
fly launch --dockerfile apps/worker/Dockerfile --no-deploy
fly secrets set DATABASE_URL="..." REDIS_URL="..." CREDENTIALS_ENCRYPTION_KEY="..."
fly deploy
```

Em `fly.toml`, remova a seção `[http_service]` — o worker não escuta em porta
nenhuma, e o health check HTTP derrubaria o processo em loop.

---

## Conferir que está funcionando

Nos logs do host, a primeira linha ao subir é:

```json
{"level":"info","message":"worker.started","ts":"..."}
```

Depois disso, uma prova de ponta a ponta: vá em **Integrações** no site e peça
uma sincronização. O worker deve registrar `sync.start` e `sync.done`. Sem
marketplace conectado, o resultado esperado é um erro registrado dizendo que a
API não está disponível — o que também prova que a mensagem chegou.

## Sinais de que algo está errado

| Sintoma | Causa provável |
| --- | --- |
| Worker sobe e não faz nada | `REDIS_URL` diferente da usada pelo site — cada um numa fila |
| `Can't reach database server` | `DATABASE_URL` errado, ou o Neon dormindo (free tier acorda na primeira conexão) |
| Tokens de marketplace ilegíveis | `CREDENTIALS_ENCRYPTION_KEY` diferente da Vercel |
| Alertas de WhatsApp não chegam | Configuração não verificada — o agendador só envia para número verificado |

## Custo

Railway e Render cobram por uso; este worker fica ocioso quase o tempo todo,
esperando na fila. Na prática cabe no crédito gratuito mensal do Railway. O
Neon e o Upstash já estão no gratuito.
