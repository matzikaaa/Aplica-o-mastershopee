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
 * Junta a configuração de todos os arquivos conhecidos, na ordem de prioridade.
 *
 * Lê vários, não só o primeiro que existir, e ignora valor vazio. Isso não é
 * capricho: um `.env` nascido do `.env.example` tem as linhas certas e sem
 * valor, e parar nele deixava a configuração completa de `vercel env pull`
 * fora do alcance — com as duas na pasta e a importação recusando rodar.
 *
 * `vercel env pull` entra aqui de propósito. As três variáveis que faltavam
 * são segredos de produção, e copiá-las à mão do painel é onde a coisa
 * emperra; o comando as traz inteiras, sem ninguém digitar segredo nenhum.
 *
 * O ambiente sempre vence o arquivo, para `DATABASE_URL=... pnpm importar`
 * continuar mandando mais.
 */
interface ArquivoLido {
  caminho: string;
  /** Se alguma variável ainda não definida veio daqui. */
  aproveitado: boolean;
}

function carregarEnv(): ArquivoLido[] {
  const candidatos = [
    process.env.ENV_FILE,
    resolve(raiz, ".env"),
    resolve(raiz, ".env.local"),
    // Onde `vercel env pull` grava, conforme a versão e o nome pedido.
    resolve(raiz, ".env.production.local"),
    resolve(raiz, ".vercel/.env.production.local"),
    resolve(raiz, "apps/web/.env"),
    resolve(raiz, "apps/web/.env.local"),
    resolve(raiz, "apps/web/.env.production.local"),
    resolve(raiz, "apps/web/.vercel/.env.production.local"),
  ].filter((c): c is string => Boolean(c));

  const lidos: ArquivoLido[] = [];

  for (const caminho of candidatos) {
    if (!existsSync(caminho)) continue;
    // `\ufeff`: o Bloco de Notas do Windows grava UTF-8 com BOM, e ele gruda
    // no nome da primeira variável — que então nunca casa e some sem aviso.
    const texto = readFileSync(caminho, "utf8").replace(/^\ufeff/, "");
    let aproveitou = false;

    for (const linha of texto.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
      if (!m) continue;
      const chave = m[1]!;
      if (process.env[chave]) continue;

      let valor = (m[2] ?? "").trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      // Linha sem valor não conta como configurada: é justamente a linha que
      // o próximo arquivo precisa poder preencher.
      if (!valor) continue;

      process.env[chave] = valor;
      aproveitou = true;
    }

    // Entram na lista também os que não contribuíram nada. Um arquivo que
    // existe e está vazio é informação: foi o caso do `vercel env pull` sem
    // `--environment=production`, que baixa o ambiente de desenvolvimento e
    // grava um arquivo sem nada dentro. Listar só os aproveitados escondia
    // justamente o arquivo que explicava a falha.
    lidos.push({ caminho, aproveitado: aproveitou });
  }

  return lidos;
}

function descreverArquivos(lidos: ArquivoLido[]): string {
  if (lidos.length === 0) return "(nenhum — só o ambiente)";
  return lidos
    .map((a) => (a.aproveitado ? a.caminho : `${a.caminho} (existe, mas sem nada aproveitável)`))
    .join("\n                ");
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
  const arquivosEnv = carregarEnv();
  log(`Configuração: ${descreverArquivos(arquivosEnv)}`);

  // Vazio e ausente são problemas diferentes e o conserto é diferente: uma
  // linha em branco veio de um .env copiado do .env.example (a variável está
  // lá, sem valor); ausente é linha que não existe. Dizer só "faltam" mandava
  // criar de novo um arquivo que já estava criado.
  const obrigatorias = [
    "DATABASE_URL",
    "CREDENTIALS_ENCRYPTION_KEY",
    "SHOPEE_PARTNER_ID",
    "SHOPEE_PARTNER_KEY",
  ];
  const problemas = obrigatorias
    .filter((v) => !process.env[v])
    .map((v) => (process.env[v] === undefined ? `  ${v} — não existe no arquivo` : `  ${v} — está no arquivo, mas sem valor`));

  // `[SENSITIVE]`: o que `vercel env pull` grava no lugar de uma variável
  // marcada como Sensitive, porque o valor dela não pode ser lido de volta.
  // O arquivo vem completo, com todos os nomes presentes, e só o conteúdo que
  // importa é placeholder — então a configuração parece pronta e falha
  // adiante, em erro de assinatura ou de decifragem, longe da causa.
  const placeholders = obrigatorias.filter((v) => process.env[v] === "[SENSITIVE]");
  for (const v of placeholders) {
    problemas.push(`  ${v} — veio como [SENSITIVE]: a Vercel não devolve o valor de variável marcada como Sensitive`);
  }

  // A chave de cifra falha tarde e feio: o script conecta, acha a loja e só
  // então não consegue abrir o token — com uma mensagem sobre criptografia que
  // não aponta para o .env. Estes dois casos são os que acontecem de verdade:
  // o texto de exemplo copiado como se fosse valor, e uma chave de tamanho
  // errado, que parece configurada e não serve.
  const chave = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (chave === "[SENSITIVE]") {
    // Já relatado acima, com a explicação certa; medir os bytes de um
    // placeholder só acrescentaria um número sem sentido.
  } else if (chave === "generate-a-real-32-byte-base64-key") {
    problemas.push("  CREDENTIALS_ENCRYPTION_KEY — está com o texto de exemplo, não com a chave real");
  } else if (chave && Buffer.from(chave, "base64").length !== 32) {
    problemas.push(
      `  CREDENTIALS_ENCRYPTION_KEY — tem ${Buffer.from(chave, "base64").length} bytes, precisa de 32 (copie a da Vercel)`,
    );
  }

  if (problemas.length > 0) {
    throw new ErroDeUso(
      `Faltam valores de configuração:\n${problemas.join("\n")}\n\n` +
        `Arquivos: ${descreverArquivos(arquivosEnv)}\n\n` +
        "O jeito curto, sem copiar segredo nenhum à mão — na raiz do projeto:\n" +
        "  npx vercel@latest link\n" +
        "  npx vercel@latest env pull .env.production.local --environment=production\n" +
        "  pnpm importar:shopee\n\n" +
        "A flag --environment=production não é opcional: sem ela o comando baixa o\n" +
        "ambiente de desenvolvimento, que costuma estar vazio, e grava um arquivo sem nada.\n\n" +
        "Se o pull disse \"Secret values cannot be pulled\", essas variáveis ficaram como\n" +
        "[SENSITIVE] e precisam vir de outro lugar — um .env na raiz tem prioridade sobre\n" +
        "o arquivo puxado, então basta escrever nele só as que faltam:\n" +
        "  DATABASE_URL             → painel do Neon\n" +
        "  SHOPEE_PARTNER_ID/KEY    → console da Shopee Open Platform\n" +
        "  CREDENTIALS_ENCRYPTION_KEY → onde você guardou ao configurar; a Vercel não a devolve\n\n" +
        "À mão, se preferir: Vercel → Settings → Environment Variables → olho de cada uma.\n" +
        "A CREDENTIALS_ENCRYPTION_KEY precisa ser exatamente a mesma da Vercel — é ela que abre o token da loja já salvo no banco.",
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
