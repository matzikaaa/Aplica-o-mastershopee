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

## 2. Criar o arquivo `.env` na raiz

Copie os valores **da própria Vercel** (Settings → Environment Variables →
ícone de olho em cada uma). O arquivo `.env` está no `.gitignore`, então ele
não vai para o Git.

```
DATABASE_URL="...?sslmode=require"
CREDENTIALS_ENCRYPTION_KEY="..."
SHOPEE_PARTNER_ID=...
SHOPEE_PARTNER_KEY=...
SHOPEE_ENV=live
SHOPEE_KEY_ENCODING=raw
```

São essas seis. `CREDENTIALS_ENCRYPTION_KEY` precisa ser **exatamente** a
mesma da Vercel — é ela que abre o token da loja que já está salvo no banco.
Com outra chave, o script não consegue decifrar o token e para dizendo isso.

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
| `Faltam variáveis de ambiente: ...` | O `.env` não foi criado na raiz, ou faltou alguma linha |
| `Não foi possível conectar ao banco` | `DATABASE_URL` errado ou sem `?sslmode=require` |
| `Nenhuma conta Shopee conectada neste banco` | O `DATABASE_URL` aponta para outro banco (ex.: o local, não o da Neon) |
| `está sem token salvo` | A autorização não foi concluída — reconecte a loja em Integrações |
| `expirou e não há refresh token` | Reconecte a loja em Integrações; depois rode de novo |
| `o cursor parou de avançar` | A Shopee devolveu a mesma janela duas vezes; rode de novo com `--recomecar` |
