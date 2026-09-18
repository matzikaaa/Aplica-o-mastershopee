# Deploy (Vercel + Neon + Upstash)

Guia para colocar o Mastershopee no ar com URL pública estável — necessário
para o processo de **Go-Live** da Shopee, que exige uma URL acessível durante
toda a análise.

Tudo abaixo cabe no plano gratuito de cada serviço.

| Serviço | O que hospeda | Plano |
|---|---|---|
| [Neon](https://neon.tech) | PostgreSQL | Free |
| [Upstash](https://upstash.com) | Redis (filas, rate limiting) | Free |
| [Vercel](https://vercel.com) | `apps/web` (Next.js) | Hobby |

> **`apps/worker` não roda na Vercel.** A Vercel não mantém processos
> longos. Sem o worker, o app funciona normalmente (login, dashboard,
> conexão de marketplace), mas **não sincroniza dados em segundo plano** —
> pedidos não são importados e métricas diárias não são agregadas. Ver
> "Worker" no fim deste documento.

---

## 1. Banco de dados (Neon)

1. Crie conta em https://neon.tech e um projeto novo (região mais próxima: `AWS South America (São Paulo)` se disponível, senão `US East`).
2. Copie a **connection string**. O Neon oferece duas — pegue a **pooled**, que
   tem `-pooler` no host: `postgresql://user:senha@ep-xxx-pooler.neon.tech/neondb?sslmode=require`.
   (Na tela do Neon costuma haver um seletor "Pooled connection" / "Connection pooling".)
3. Guarde: será o `DATABASE_URL`.

> **Use a string pooled, não a direta.** Cada invocação de função serverless na
> Vercel abre sua própria conexão; sem o pooler, um pico de tráfego estoura o
> limite de conexões do Postgres e as requisições passam a falhar com
> "too many connections". A string direta (sem `-pooler`) serve para
> migrations rodadas da sua máquina, onde é uma conexão só.

## 2. Redis (Upstash)

1. Crie conta em https://upstash.com → **Create Database** → tipo **Redis**.
2. Na página do banco, aba **REST/Redis**, copie a URL no formato `rediss://default:senha@xxx.upstash.io:6379`.
3. Guarde: será o `REDIS_URL`. (Note o `rediss://` com dois "s" — TLS.)

## 3. Segredos

Gere dois valores distintos de 32 bytes em base64. No PowerShell:

```powershell
[Convert]::ToBase64String([byte[]](0..31 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

Rode duas vezes: o primeiro valor vai em `AUTH_SECRET`, o segundo em
`CREDENTIALS_ENCRYPTION_KEY`.

> Não reaproveite os valores do seu `.env` local. Ambiente de produção usa
> segredos próprios — e o `CREDENTIALS_ENCRYPTION_KEY` em particular é o que
> decripta os tokens de marketplace: se ele for trocado depois, todas as
> contas conectadas precisam ser reconectadas.

## 4. Deploy na Vercel

1. Em https://vercel.com → **Add New → Project** → importe o repositório do GitHub.
2. Em **Root Directory**, selecione `apps/web`.
3. Framework Preset: **Next.js** (detectado automaticamente).
4. Não altere Build/Install Command — a Vercel detecta o workspace pnpm, e o
   `postinstall` de `packages/database` roda o `prisma generate` sozinho.
5. Em **Environment Variables**, adicione (todas em Production):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | connection string do Neon (passo 1) |
| `REDIS_URL` | URL do Upstash (passo 2) |
| `AUTH_SECRET` | primeiro segredo gerado (passo 3) |
| `CREDENTIALS_ENCRYPTION_KEY` | segundo segredo gerado (passo 3) |
| `NODE_ENV` | `production` |
| `SHOPEE_PARTNER_ID` | seu Partner ID (ver nota abaixo) |
| `SHOPEE_PARTNER_KEY` | sua Partner Key |
| `SHOPEE_ENV` | `test` por enquanto |

> **A Shopee é um ovo-e-galinha: o Go-Live exige uma URL no ar, e a URL Live
> só existe depois do Go-Live aprovado.** Suba com as credenciais de Test (ou
> deixe os três campos em branco — o app sobe igual e mostra "não
> configurado"), pegue a URL, submeta o formulário, e troque para as
> credenciais Live com `SHOPEE_ENV=live` só depois da aprovação.

6. Clique em **Deploy**. Ao terminar, anote a URL gerada (ex.: `https://mastershopee.vercel.app`).

7. Volte em **Settings → Environment Variables** e adicione, agora usando a URL real:

| Variável | Valor |
|---|---|
| `APP_URL` | `https://SEU-APP.vercel.app` |
| `NEXTAUTH_URL` | `https://SEU-APP.vercel.app` |
| `SHOPEE_REDIRECT_URL` | `https://SEU-APP.vercel.app/api/integrations/shopee/callback` |

8. **Redeploy** (Deployments → menu `...` do último deploy → Redeploy) para as
   novas variáveis valerem.

## 5. Migrations

As migrations não rodam sozinhas no deploy. Da sua máquina, aponte para o
banco de produção e aplique uma única vez:

```powershell
$env:DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
pnpm --filter @mastershopee/database exec prisma migrate deploy
pnpm --filter @mastershopee/database exec tsx prisma/seed.ts
```

O `seed.ts` cria **apenas o catálogo de planos** — nenhum dado fictício.

> Se quiser popular o ambiente com dados de demonstração para os revisores da
> Shopee verem o produto funcionando, veja "Conta de demonstração" abaixo.

## 6. Verificação rápida

Antes de entregar a URL para a Shopee, confira em janela anônima:

| O que | Deve |
|---|---|
| `https://SEU-APP.vercel.app/` | abrir a landing page |
| `/privacidade` e `/termos` | abrir sem login — o revisor lê os dois |
| `/login` | aceitar o login demo |
| `/api/integrations/shopee/callback` | responder algo (não precisa funcionar sozinho) |

Se `/login` recusar credenciais corretas, quase sempre é `NEXTAUTH_URL`
diferente do domínio que o navegador está usando — o erro aparece como "e-mail
ou senha incorretos", que engana.

## 7. Shopee

No console da Shopee, no seu app, configure **Live Redirect URL Domain** como:

```
https://SEU-APP.vercel.app
```

(só o domínio, sem caminho — o mesmo formato usado no Test Redirect URL Domain)

---

## Conta de demonstração para a análise da Shopee

O formulário de Go-Live pede usuário e senha de teste para os revisores
acessarem o produto. Como um ambiente recém-criado está vazio (por design —
§75, §94), popule uma conta claramente marcada como demonstração:

```powershell
$env:DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
$env:NODE_ENV="production"
$env:ALLOW_DEMO_SEED="true"
pnpm --filter @mastershopee/database exec tsx prisma/seed-demo.ts
```

Isso cria `demo@mastershopee.app` com a senha `demo12345`. **Troque a senha
antes de entregar o login**, porque `demo12345` está publicada no README deste
repositório, que é público — sem trocar, qualquer pessoa que leia o repo entra
na conta que você deu à Shopee:

```powershell
$env:DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
pnpm db:set-password demo@mastershopee.app 'uma-senha-forte-e-unica'
```

É `demo@mastershopee.app` + essa senha nova que vão nos campos "Test
Username/Password of Business Product".

Todo o dado criado é prefixado com `[DEMO]` e some com
`prisma/purge-demo.ts` quando não for mais necessário. O `ALLOW_DEMO_SEED`
existe exatamente para este caso: um ambiente de produção que precisa,
temporariamente, de dados visíveis para revisão externa.

## Worker

`apps/worker` precisa de um host que mantenha processo longo (Railway,
Render, Fly.io, ou qualquer VPS). Sem ele:

- pedidos não são importados das APIs de marketplace;
- `DailyMetric`/`ProductMetric` não são agregados;
- alertas e relatório diário no WhatsApp não disparam.

Há um `apps/worker/Dockerfile` pronto, construído a partir da raiz do
repositório. O passo a passo para Railway, Render e Fly.io — com as variáveis
necessárias e as armadilhas de cada um — está em
[`docs/worker/deploy.md`](docs/worker/deploy.md).

---

## Deploy travado ou código velho no ar

Um deploy que trava em **Initializing** não derruba o site: a Vercel continua
servindo o deploy anterior, em silêncio. É a pior falha possível de depurar,
porque o site responde normalmente — com o código antigo. Toda investigação
começa por descobrir **qual commit está realmente no ar**.

### 1. Qual commit está no ar

Toda resposta do site carrega o cabeçalho `X-Mastershopee-Build` com os 7
primeiros caracteres do commit. No PowerShell:

```powershell
(Invoke-WebRequest https://SEU-APP.vercel.app).Headers["X-Mastershopee-Build"]
```

Compare com o seu commit local:

```powershell
git rev-parse --short HEAD
```

Iguais → o código está publicado e o problema é outro. Diferentes → o deploy
não subiu, e nenhum teste na interface vale nada até subir.

Logado, `https://SEU-APP.vercel.app/api/health` mostra o mesmo em detalhe
(`deploy.commit`, `deploy.branch`, `deploy.compiladoEm`), junto do diagnóstico
de banco, autenticação e integrações.

### 2. Destravar

Na ordem — cada passo elimina uma causa:

1. **Cancel** no deploy travado (menu `...`), depois **Redeploy**. Se voltar a
   travar, não insista: repetir não muda nada.
2. **Redeploy sem cache** — no diálogo de redeploy, desmarque *Use existing
   Build Cache*. A restauração do cache acontece justamente na fase
   "Initializing"; um cache corrompido trava exatamente aí, e essa é a única
   causa de travamento nessa fase que está ao seu alcance.
3. Confira https://www.vercel-status.com. Incidente aberto → é espera, não
   configuração.

### 3. Publicar sem passar pela fila da Vercel

Se nada acima destravar, o deploy pode sair da sua máquina. O build roda
localmente e sobe pronto — a fila de build da Vercel fica de fora do caminho:

```powershell
npx vercel@latest login
npx vercel@latest link
npx vercel@latest pull --environment=production
npx vercel@latest build --prod
npx vercel@latest deploy --prebuilt --prod
```

No `link`, escolha o projeto existente (não crie outro) e informe `apps/web`
como diretório raiz quando perguntado. O `pull` traz as variáveis de ambiente
de produção para um `.vercel/` local — que já está no `.gitignore`.

Para ver o que um deploy travado está fazendo:

```powershell
npx vercel@latest inspect https://URL-DO-DEPLOY.vercel.app --logs
```

### 4. O que não depende de deploy nenhum

Importar pedidos e SKUs não precisa da Vercel: `pnpm importar:shopee` fala
direto com a Shopee e com o banco. Ver [docs/importar-shopee.md](docs/importar-shopee.md).
