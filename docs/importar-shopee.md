# Importar o histórico da Shopee pelo terminal

A importação pela tela funciona, mas em fatias: a função que roda na Vercel
tem teto de 60 segundos, então cada clique traz algumas páginas e devolve
"ainda há mais". Uma loja com meses de histórico precisa de dezenas dessas
fatias, e qualquer tropeço no meio — um deploy travado, a aba fechada, um
504 — faz recomeçar a espera.

Este caminho não tem teto: roda na sua máquina, pagina até o fim, grava o
cursor a cada página e recalcula as métricas no final. **Não depende de a
Vercel ter terminado o deploy** — fala direto com a Shopee e com o banco.

## 1. Preparar o projeto (uma vez)

```bash
git clone https://github.com/matzikaaa/aplica-o-mastershopee.git
cd aplica-o-mastershopee
git checkout claude/saas-marketplace-finance-2r3hk0
pnpm install
```

Se já tem o clone, basta atualizar:

```bash
git checkout claude/saas-marketplace-finance-2r3hk0
git pull origin claude/saas-marketplace-finance-2r3hk0
pnpm install
```

## 2. A configuração

### O jeito curto (recomendado — não digita segredo nenhum)

A própria Vercel entrega as variáveis de produção prontas:

```powershell
npx vercel@latest link
npx vercel@latest env pull .env.production.local --environment=production
```

No `link`, escolha o projeto **existente** e informe `apps/web` como diretório
raiz. Pronto — o arquivo gerado já está no `.gitignore`.

> **`--environment=production` não é opcional.** O nome do arquivo não escolhe
> o ambiente: sem a flag o comando baixa o `development`, que costuma estar
> vazio, grava um arquivo sem nada e diz "Created" do mesmo jeito. Confira a
> linha que ele imprime — tem que dizer `Downloading \`production\`
> environment variables`.

> **Variáveis marcadas como Sensitive não voltam.** Se o pull terminar com
> *"Secret values cannot be pulled"*, essas vieram como `[SENSITIVE]` — nome
> presente, valor não. O arquivo parece completo e falha adiante, em erro de
> assinatura ou de decifragem. Complete só essas num `.env` na raiz, que tem
> prioridade sobre o arquivo puxado:
>
> | Variável | Onde conseguir de novo |
> | --- | --- |
> | `DATABASE_URL` | painel do Neon |
> | `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` | console da Shopee Open Platform |
> | `CREDENTIALS_ENCRYPTION_KEY` | onde você guardou ao configurar — a Vercel não devolve |
>
> Perdeu a `CREDENTIALS_ENCRYPTION_KEY`? Ela é o que decifra os tokens de
> marketplace já salvos. Sem ela, o jeito é gerar outra, gravar na Vercel e
> **reconectar as lojas** — os tokens antigos ficam ilegíveis. Não faça isso
> sem necessidade.

### À mão

Se preferir, crie um `.env` na raiz com estas seis linhas, pegando os valores
em **Vercel → Settings → Environment Variables → olho de cada uma**:

```
DATABASE_URL="...?sslmode=require"
CREDENTIALS_ENCRYPTION_KEY="..."
SHOPEE_PARTNER_ID=...
SHOPEE_PARTNER_KEY=...
SHOPEE_ENV=live
SHOPEE_KEY_ENCODING=raw
```

`CREDENTIALS_ENCRYPTION_KEY` precisa ser **exatamente** a mesma da Vercel — é
ela que abre o token da loja já salvo no banco. O script confere o tamanho e
recusa o texto de exemplo antes de começar, em vez de falhar no meio.

> Os dois jeitos convivem: o script lê todos os arquivos que encontrar e
> ignora linha sem valor. Um `.env` copiado do `.env.example`, com as linhas
> certas e vazias, é completado pelo arquivo que veio da Vercel.

## 3. Rodar

```bash
pnpm importar:shopee
```

O padrão é catálogo (SKUs) + 120 dias de pedidos. A saída vai mostrando:

```
[08:12:03] Loja: SHOPEE — 1234567 (shop_id 1234567)
[08:12:04] Importando catálogo (SKUs)…
[08:12:11] Catálogo pronto: 87 SKUs.
[08:12:11] Importando pedidos dos últimos 120 dias, retomando de onde parou.
[08:12:19]   página 1: 20 pedidos (20 no total) — próxima janela: 03/07/2026
...
── Situação do banco ──────────────────────────────
  pedidos gravados......... 412
  período.................. 21/05/2026 até 18/09/2026
  SKUs..................... 87 (87 sem custo cadastrado)
  itens sem custo conhecido 998
───────────────────────────────────────────────────
```

Pode interromper com `Ctrl+C` a qualquer momento: o cursor é gravado a cada
página, e rodar de novo continua exatamente de onde parou.

### Opções

| Comando | O que faz |
| --- | --- |
| `pnpm importar:shopee --dias=180` | Busca mais histórico (limite da Shopee: o que a loja tiver) |
| `pnpm importar:shopee --recomecar` | Ignora o cursor e varre a janela inteira de novo |
| `pnpm importar:shopee --so-catalogo` | Só os SKUs, sem tocar em pedidos |
| `pnpm importar:shopee --so-pedidos` | Só os pedidos |
| `pnpm importar:shopee --conta=<id>` | Escolhe a loja quando há mais de uma conectada |

## 4. Depois de importar

1. Abra **Produtos** no site: os SKUs já estão lá.
2. Cadastre o custo de cada um.
3. Não precisa reimportar nada — ao salvar um custo, o lucro dos pedidos que
   já entraram é recalculado sozinho (é o que o contador "itens sem custo
   conhecido" acompanha; ele cai a cada custo cadastrado).

## Se der errado

| Mensagem | O que significa |
| --- | --- |
| `Faltam valores de configuração: ...` | A mensagem diz, de cada uma, se a linha não existe ou está sem valor |
| `Não foi possível conectar ao banco` | `DATABASE_URL` errado ou sem `?sslmode=require` |
| `Nenhuma conta Shopee conectada neste banco` | O `DATABASE_URL` aponta para outro banco (ex.: o local, não o da Neon) |
| `está sem token salvo` | A autorização não foi concluída — reconecte a loja em Integrações |
| `expirou e não há refresh token` | Reconecte a loja em Integrações; depois rode de novo |
| `o cursor parou de avançar` | A Shopee devolveu a mesma janela duas vezes; rode de novo com `--recomecar` |
