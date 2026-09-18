/**
 * Importa o histórico inteiro da Shopee numa única execução, no terminal.
 *
 * A importação pela web funciona, mas em fatias: uma função serverless tem
 * teto de 60 segundos, então cada clique traz algumas páginas, grava o cursor
 * e devolve "ainda há mais". Uma loja com meses de histórico precisa de
 * dezenas dessas fatias, e qualquer tropeço no meio — um deploy travado, uma
 * aba fechada, um 504 — recomeça a novela. Foi exatamente o que consumiu um
 * dia inteiro de tentativas.
 *
 * Aqui não há teto. O script pagina até o fim, grava o cursor a cada página
 * (então interromper com Ctrl+C não perde nada), renova o token quando ele
 * envelhece e recalcula as métricas dos dias tocados no final.
 *
 * Uso, na raiz do projeto:
 *   pnpm importar:shopee                 # catálogo + 120 dias de pedidos
 *   pnpm importar:shopee --dias=180
 *   pnpm importar:shopee --recomecar     # ignora o cursor e varre de novo
 *   pnpm importar:shopee --so-pedidos
 *   pnpm importar:shopee --so-catalogo
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prisma,
  createSyncCache,
  recomputeMetricsForDays,
  resolveFreshCredentials,
  countItemsWithUnknownCost,
  upsertMarketplaceProduct,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import { ShopeeProvider, decryptSecret, encryptSecret } from "@mastershopee/integrations";
import { getIntegrationEnv } from "../integration-env.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../../../..");

/**
 * Lê o `.env` sem depender de pacote novo — e sem sobrescrever o que já veio
 * do ambiente, para que `DATABASE_URL=... pnpm importar:shopee` continue
 * mandando mais que o arquivo.
 */
function carregarEnv(): string | null {
  const candidatos = [
    process.env.ENV_FILE,
    resolve(raiz, ".env"),
    resolve(raiz, "apps/web/.env"),
    resolve(raiz, "apps/web/.env.local"),
  ].filter((c): c is string => Boolean(c));

  for (const caminho of candidatos) {
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
      if (!m) continue;
      const chave = m[1]!;
      if (process.env[chave] !== undefined) continue;
      let valor = (m[2] ?? "").trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      process.env[chave] = valor;
    }
    return caminho;
  }
  return null;
}

function arg(nome: string): string | undefined {
  const achado = process.argv.slice(2).find((a) => a === `--${nome}` || a.startsWith(`--${nome}=`));
  if (!achado) return undefined;
  const igual = achado.indexOf("=");
  return igual === -1 ? "" : achado.slice(igual + 1);
}

const brasilia = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dia = (d: Date | null | undefined) => (d ? brasilia.format(d) : "—");
const relogio = () => new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });

function log(mensagem: string) {
  console.log(`[${relogio()}] ${mensagem}`);
}

/** Erro previsto, com instrução — sai sem pilha de stack assustando ninguém. */
class ErroDeUso extends Error {}

async function main() {
  const arquivoEnv = carregarEnv();
  log(arquivoEnv ? `Configuração lida de ${arquivoEnv}` : "Usando apenas variáveis do ambiente");

  const faltando = [
    "DATABASE_URL",
    "CREDENTIALS_ENCRYPTION_KEY",
    "SHOPEE_PARTNER_ID",
    "SHOPEE_PARTNER_KEY",
  ].filter((v) => !process.env[v]);
  if (faltando.length > 0) {
    throw new ErroDeUso(
      `Faltam variáveis de ambiente: ${faltando.join(", ")}.\n` +
        "Copie os mesmos valores que estão na Vercel para um arquivo .env na raiz do projeto.",
    );
  }

  const dias = Math.min(Math.max(Number(arg("dias") ?? 120), 1), 365);
  const recomecar = arg("recomecar") !== undefined;
  const soPedidos = arg("so-pedidos") !== undefined;
  const soCatalogo = arg("so-catalogo") !== undefined;

  const contas = await prisma.marketplaceAccount.findMany({
    where: { marketplace: "SHOPEE", status: { not: "DISCONNECTED" }, credential: { isNot: null } },
    orderBy: [{ connectedAt: "desc" }, { createdAt: "desc" }],
  });

  if (contas.length === 0) {
    throw new ErroDeUso(
      "Nenhuma conta Shopee conectada neste banco.\n" +
        "Confira se o DATABASE_URL aponta para o mesmo banco da aplicação e conecte a loja em Integrações.",
    );
  }

  const escolhida = arg("conta");
  const conta = escolhida ? contas.find((c) => c.id === escolhida) : contas[0];
  if (!conta) {
    throw new ErroDeUso(
      `Conta ${escolhida} não encontrada. Contas disponíveis:\n` +
        contas.map((c) => `  ${c.id}  ${c.displayName}`).join("\n"),
    );
  }
  if (contas.length > 1 && !escolhida) {
    log(`Há ${contas.length} contas Shopee; usando "${conta.displayName}". Use --conta=<id> para outra.`);
  }

  log(`Loja: ${conta.displayName} (shop_id ${conta.externalShopId})`);

  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  // O token da Shopee vale 4 horas e uma varredura longa atravessa esse
  // prazo. Em vez de resolver uma vez no começo, o script pede credenciais
  // frescas de tempos em tempos — `resolveFreshCredentials` só renova de
  // fato quando está perto de vencer.
  let credenciais = await resolveFreshCredentials({
    accountId: conta.id,
    externalShopId: conta.externalShopId,
    provider,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
  });
  let renovadoEm = Date.now();
  const credenciaisFrescas = async () => {
    if (Date.now() - renovadoEm < 30 * 60 * 1000) return credenciais;
    credenciais = await resolveFreshCredentials({
      accountId: conta.id,
      externalShopId: conta.externalShopId,
      provider,
      encrypt: encryptSecret,
      decrypt: decryptSecret,
    });
    renovadoEm = Date.now();
    return credenciais;
  };

  // ── Catálogo ──────────────────────────────────────────────────────────
  // Antes dos pedidos de propósito: é o catálogo que faz os SKUs aparecerem
  // na tela de custos, e um pedido importado sem custo cadastrado entra
  // marcado como "custo desconhecido".
  if (!soPedidos) {
    log("Importando catálogo (SKUs)…");
    let cursor = { value: null as string | null };
    let temMais = true;
    let gravados = 0;
    while (temMais) {
      const pagina = await provider.fetchProducts(await credenciaisFrescas(), cursor);
      for (const p of pagina.items) {
        await upsertMarketplaceProduct(conta, {
          sku: p.sku,
          title: p.title,
          imageUrl: p.imageUrl,
          externalProductId: p.externalProductId,
          externalVariationId: p.externalVariationId,
        });
        gravados++;
      }
      if (pagina.items.length > 0) log(`  ${gravados} SKUs…`);
      if (pagina.nextCursor.value === cursor.value && pagina.items.length === 0) break;
      cursor = pagina.nextCursor;
      temMais = pagina.hasMore;
    }
    log(`Catálogo pronto: ${gravados} SKUs.`);
  }

  if (soCatalogo) {
    await relatorio(conta);
    return;
  }

  // ── Pedidos ───────────────────────────────────────────────────────────
  const cache = createSyncCache();
  const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);
  let cursor = { value: recomecar ? null : conta.lastSyncCursor };
  let temMais = true;
  let pedidos = 0;
  let semTaxaConfirmada = 0;
  let paginas = 0;
  const diasTocados = new Set<string>();

  log(
    recomecar
      ? `Importando pedidos dos últimos ${dias} dias, do começo.`
      : `Importando pedidos dos últimos ${dias} dias, retomando de onde parou.`,
  );

  try {
    while (temMais) {
      const pagina = await provider.fetchOrders(await credenciaisFrescas(), cursor, desde);

      for (const pedido of pagina.items) {
        await upsertNormalizedOrder(conta, pedido, cache);
        pedidos++;
        if (pedido.feesFromEscrow === false) semTaxaConfirmada++;
        diasTocados.add(pedido.orderedAt.toISOString().slice(0, 10));
      }

      const anterior = cursor.value;
      cursor = pagina.nextCursor;
      temMais = pagina.hasMore;
      paginas++;

      // O cursor é gravado a cada página: interromper com Ctrl+C, cair a
      // internet ou fechar o terminal não custa o trabalho já feito.
      await prisma.marketplaceAccount.update({
        where: { id: conta.id },
        data: { lastSyncCursor: cursor.value },
      });

      const [janela] = (cursor.value ?? "").split("|");
      const posicao = janela ? dia(new Date(Number(janela) * 1000)) : "fim do histórico";
      log(`  página ${paginas}: ${pagina.items.length} pedidos (${pedidos} no total) — próxima janela: ${posicao}`);

      // Rede de segurança contra um cursor que não anda: sem ela, um defeito
      // do outro lado viraria um laço infinito silencioso — que é pior do
      // que parar com uma mensagem.
      if (temMais && cursor.value === anterior && pagina.items.length === 0) {
        log("  o cursor parou de avançar; interrompendo para não girar em falso.");
        break;
      }
    }
  } catch (err) {
    await prisma.marketplaceAccount.update({
      where: { id: conta.id },
      data: {
        lastSyncCursor: cursor.value,
        lastErrorMessage: err instanceof Error ? err.message : "erro na importação",
      },
    });
    log(`Interrompido: ${err instanceof Error ? err.message : err}`);
    log("O cursor foi salvo — rodar de novo continua daqui.");
    await recalcular(conta.workspaceId, diasTocados);
    await relatorio(conta);
    process.exitCode = 1;
    return;
  }

  await recalcular(conta.workspaceId, diasTocados);

  await prisma.marketplaceAccount.update({
    where: { id: conta.id },
    data: {
      status: "CONNECTED",
      lastSyncAt: new Date(),
      lastSyncCursor: cursor.value,
      lastErrorMessage: null,
    },
  });

  log(`Pedidos importados nesta execução: ${pedidos} (${paginas} páginas).`);
  if (semTaxaConfirmada > 0) {
    log(
      `${semTaxaConfirmada} pedidos entraram com taxa estimada — a Shopee ainda não liberou o repasse deles.`,
    );
  }
  await relatorio(conta);
}

async function recalcular(workspaceId: string, dias: Set<string>) {
  if (dias.size === 0) return;
  log(`Recalculando métricas de ${dias.size} dias…`);
  await recomputeMetricsForDays(workspaceId, [...dias]);
}

/** O mesmo retrato da tela "Situação", para fechar a execução com fatos. */
async function relatorio(conta: { id: string; workspaceId: string }) {
  const [total, primeiro, ultimo, produtos, semCusto, itensSemCusto] = await Promise.all([
    prisma.order.count({ where: { marketplaceAccountId: conta.id } }),
    prisma.order.findFirst({
      where: { marketplaceAccountId: conta.id },
      orderBy: { orderedAt: "asc" },
      select: { orderedAt: true },
    }),
    prisma.order.findFirst({
      where: { marketplaceAccountId: conta.id },
      orderBy: { orderedAt: "desc" },
      select: { orderedAt: true },
    }),
    prisma.product.count({ where: { workspaceId: conta.workspaceId } }),
    prisma.product.count({ where: { workspaceId: conta.workspaceId, costs: { none: {} } } }),
    countItemsWithUnknownCost(conta.workspaceId),
  ]);

  console.log("");
  console.log("── Situação do banco ──────────────────────────────");
  console.log(`  pedidos gravados......... ${total}`);
  console.log(`  período.................. ${dia(primeiro?.orderedAt)} até ${dia(ultimo?.orderedAt)}`);
  console.log(`  SKUs..................... ${produtos} (${semCusto} sem custo cadastrado)`);
  console.log(`  itens sem custo conhecido ${itensSemCusto}`);
  console.log("───────────────────────────────────────────────────");
  if (semCusto > 0) {
    console.log(
      `Cadastre o custo dos ${semCusto} SKUs em Produtos — o lucro dos pedidos já importados é recalculado sozinho.`,
    );
  }
}

main()
  .catch((err) => {
    if (err instanceof ErroDeUso) {
      console.error(`\n${err.message}\n`);
    } else if (err instanceof Error && err.name === "PrismaClientInitializationError") {
      // Sem senha na tela: a string de conexão vive no erro do Prisma e este
      // script costuma rodar com a tela compartilhada.
      console.error(
        "\nNão foi possível conectar ao banco.\n" +
          "Confira o DATABASE_URL do .env — tem que ser o mesmo da Vercel, com `?sslmode=require` no fim.\n",
      );
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
