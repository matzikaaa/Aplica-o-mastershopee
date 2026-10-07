import { NextResponse } from "next/server";
import {
  createSyncCache,
  prisma,
  recomputeMetricsForDays,
  resolveFreshCredentials,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import {
  ShopeeProvider,
  decryptSecret,
  ehDesautorizacao,
  encontrarBaseQueAssina,
  encryptSecret,
  parseShopeePush,
  pedidoDoPush,
  variacoesDeUrl,
  verifyShopeePush,
} from "@mastershopee/integrations";
import { waitUntil } from "@vercel/functions";
import { getIntegrationEnv } from "@/lib/integration-env";
import { shopeePushKey, shopeePushUrl } from "@/lib/shopee-push-url";

export const maxDuration = 30;

/**
 * Códigos de push que significam "a loja retirou a autorização".
 *
 * Variável de ambiente porque é o único caso que não dá para deduzir do
 * conteúdo — ele não cita pedido nenhum — e a numeração dos mecanismos é da
 * Shopee, não nossa. Errar o número aqui desliga só este tratamento especial;
 * nenhum pedido deixa de entrar por causa disso.
 */
function codigosDeDesautorizacao(): number[] {
  const bruto = process.env.SHOPEE_PUSH_CODES_DEAUTH ?? "2";
  return bruto
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n));
}

/**
 * Os avisos que a Shopee manda quando um pedido muda.
 *
 * É o único caminho que traz um pedido em segundos em vez de na próxima
 * rodada. As varreduras continuam existindo e continuam necessárias: push se
 * perde — entrega falha, deploy no ar no momento errado, janela de manutenção
 * — e um sistema que confia só nele descobre o buraco quando o vendedor
 * reclama de um pedido que nunca apareceu. Aqui é a via rápida; a
 * sincronização periódica é a rede.
 *
 * Responde 200 depois de registrar, mesmo quando o processamento falha. A
 * Shopee reenvia o que não foi confirmado, e reenviar não ajuda contra uma
 * falha permanente — só multiplica a mesma chamada. O evento fica gravado com
 * o erro, e a varredura periódica pega o pedido de qualquer forma.
 */
export async function POST(request: Request) {
  // Corpo cru, antes de qualquer parse: `JSON.parse` seguido de
  // `JSON.stringify` reordena chaves e muda espaços, e a assinatura é sobre
  // os bytes, não sobre o dado.
  const rawBody = await request.text();

  const env = getIntegrationEnv();
  const { chave, origem } = shopeePushKey();
  if (!chave) {
    return NextResponse.json({ error: "Shopee não configurada neste ambiente." }, { status: 503 });
  }

  const verificacao = verifyShopeePush({
    pushUrl: shopeePushUrl(),
    rawBody,
    authorization: request.headers.get("authorization"),
    partnerKey: chave,
    // A chave gerada para push é usada como está. A escolha de leitura existe
    // para o `partner_key` da API, cujo formato o console exibe de um jeito
    // ambíguo; não há motivo para ela valer sobre uma chave de outra origem.
    encoding: origem === "push" ? "raw" : (env.SHOPEE_KEY_ENCODING ?? "raw"),
  });

  const envelope = parseShopeePush(rawBody);

  // Push sem assinatura válida não vira dado, mas vira registro.
  //
  // Descartar em silêncio foi o que transformou o `error_sign` das chamadas de
  // API num dia inteiro de adivinhação: URL cadastrada diferente, chave lida
  // de outro jeito e corpo remontado produzem o mesmo sintoma, e sem registro
  // não há como separá-los. Os prefixos das duas assinaturas não entregam nada
  // a quem não tem a chave e respondem a pergunta em um minuto.
  if (!verificacao.valida) {
    await registrar({
      externalEventId: `rejeitado:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      eventType: "assinatura-invalida",
      payload: rawBody.slice(0, 4000),
      signatureValid: false,
      processingError: explicarRecusa({
        verificacao,
        origem,
        base: shopeePushUrl(),
        achada: encontrarBaseQueAssina({
          candidatas: candidatasDeUrl(request),
          rawBody,
          authorization: request.headers.get("authorization"),
          partnerKey: chave,
          encoding: origem === "push" ? "raw" : (env.SHOPEE_KEY_ENCODING ?? "raw"),
        }),
      }),
    });

    // 2xx mesmo recusando, de propósito.
    //
    // A verificação da URL no console da Shopee manda um push de teste e exige
    // resposta 2xx — responder 401 reprova a verificação e trava o cadastro
    // antes mesmo de haver uma chave configurada. E, fora da verificação, um
    // não-2xx só agenda três reenvios do mesmo aviso recusado.
    //
    // Não é afrouxamento: push sem assinatura válida não vira pedido, não toca
    // em conta e não dispara nada. Ele só é registrado, que é o que permite
    // consertar a configuração vendo a causa em vez de adivinhando.
    return NextResponse.json({ ok: true, aceito: false, motivo: "assinatura inválida" });
  }

  if (!envelope) {
    await registrar({
      externalEventId: `ilegivel:${Date.now()}`,
      eventType: "corpo-ilegivel",
      payload: rawBody.slice(0, 4000),
      signatureValid: true,
      processingError: "Assinatura válida, corpo não reconhecido.",
    });
    return NextResponse.json({ ok: true });
  }

  const conta = envelope.shopId
    ? await prisma.marketplaceAccount.findFirst({
        where: { marketplace: "SHOPEE", externalShopId: envelope.shopId, status: { not: "DISCONNECTED" } },
      })
    : null;

  // O identificador que torna o reenvio inofensivo. A Shopee não manda um id
  // de evento, então ele é montado com o que identifica a ocorrência: mesma
  // loja, mesmo tipo, mesmo pedido, mesmo instante.
  const pedido = pedidoDoPush(envelope);
  const externalEventId = `${envelope.shopId ?? "?"}:${envelope.code}:${pedido ?? "-"}:${envelope.timestamp}`;

  const existente = await prisma.webhookEvent.findUnique({
    where: { marketplace_externalEventId: { marketplace: "SHOPEE", externalEventId } },
  });
  if (existente?.processedAt) return NextResponse.json({ ok: true, repetido: true });

  const evento = await registrar({
    externalEventId,
    eventType: String(envelope.code),
    payload: rawBody.slice(0, 8000),
    signatureValid: true,
    workspaceId: conta?.workspaceId,
    marketplaceAccountId: conta?.id,
  });

  // Confirmar primeiro, trabalhar depois.
  //
  // A Shopee desiste deste push em 3 segundos e reenvia em 300s, 1800s e
  // 10800s. Buscar o pedido antes de responder — duas chamadas à API dela —
  // estoura esse teto com facilidade, e o resultado não é um aviso perdido: é
  // o mesmo aviso chegando três vezes, cada uma repetindo o trabalho e
  // estourando de novo. `waitUntil` mantém a função viva depois da resposta,
  // que é exatamente o que ela existe para fazer.
  //
  // Fora da Vercel o trabalho roda igual, só sem a garantia de sobreviver à
  // resposta — e aí a varredura periódica continua sendo a rede.
  waitUntil(processar(evento.id, envelope, conta, pedido));

  return NextResponse.json({ ok: true });
}

/**
 * O trabalho que acontece depois do 200.
 *
 * Nunca lança: isto roda fora do ciclo da resposta, então uma exceção aqui não
 * tem para onde subir. O erro vai para o evento, que é onde alguém consegue
 * vê-lo.
 */
async function processar(
  eventoId: string,
  envelope: ReturnType<typeof parseShopeePush> & object,
  conta: Awaited<ReturnType<typeof prisma.marketplaceAccount.findFirst>>,
  pedido: string | null,
) {
  try {
    if (conta && ehDesautorizacao(envelope, codigosDeDesautorizacao())) {
      // A loja revogou o acesso do lado da Shopee. Continuar tentando
      // sincronizar produziria uma fila de erros de token sem causa visível.
      await prisma.marketplaceAccount.update({
        where: { id: conta.id },
        data: { status: "TOKEN_EXPIRED", lastErrorMessage: "A loja revogou o acesso na Shopee. Reconecte." },
      });
      await prisma.notification.create({
        data: {
          workspaceId: conta.workspaceId,
          title: "Conexão com a Shopee revogada",
          body: "A autorização foi retirada no painel da Shopee. Reconecte em Integrações para voltar a sincronizar.",
        },
      });
    } else if (conta && pedido) {
      // O push é só o gatilho: o estado vem da API, nunca do corpo do aviso.
      // É o que torna inofensiva a entrega fora de ordem que a Shopee avisa
      // não garantir — dois avisos do mesmo pedido, em qualquer ordem, levam
      // ao mesmo resultado.
      await trazerPedido(conta, pedido);
    }

    await prisma.webhookEvent.update({
      where: { id: eventoId },
      data: { processedAt: new Date(), processingError: null },
    });
  } catch (err) {
    await prisma.webhookEvent
      .update({
        where: { id: eventoId },
        data: { processingError: err instanceof Error ? err.message : "falha ao processar" },
      })
      .catch(() => {
        // Banco fora do ar depois da resposta já enviada: não há mais nada a
        // fazer aqui, e deixar esta promessa rejeitar derrubaria o processo.
      });
  }
}

/**
 * As URLs que podem ter sido cadastradas no console.
 *
 * A configurada vem primeiro, mas a Vercel serve o mesmo app por vários
 * endereços — o de produção, o do branch, o único de cada deploy — e cadastrar
 * um e configurar outro é um erro que não se enxerga lendo. Os cabeçalhos de
 * encaminhamento dizem por qual deles a requisição realmente entrou, que é a
 * melhor pista disponível.
 */
function candidatasDeUrl(request: Request): string[] {
  const candidatas = [...variacoesDeUrl(shopeePushUrl())];

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) {
    for (const v of variacoesDeUrl(`${proto}://${host}/api/webhooks/shopee`)) candidatas.push(v);
  }

  try {
    const url = new URL(request.url);
    for (const v of variacoesDeUrl(`${url.origin}${url.pathname}`)) candidatas.push(v);
  } catch {
    // URL da requisição ilegível não impede as outras candidatas de serem testadas.
  }

  return [...new Set(candidatas)];
}

/**
 * A recusa explicada em uma frase que diz o que fazer.
 *
 * Alguma candidata assina: é a URL, e o conserto é um valor para copiar.
 * Nenhuma assina: é a chave, e mandar comparar endereços seria desperdiçar a
 * próxima tentativa no lugar errado.
 */
function explicarRecusa(input: {
  verificacao: { esperadaPrefixo: string; recebidaPrefixo: string };
  origem: "push" | "api";
  base: string;
  achada: string | null;
}): string {
  if (input.achada) {
    return (
      `A assinatura bate com a URL ${input.achada}, e não com ${input.base}. ` +
      `É essa que está cadastrada no console. Configure SHOPEE_PUSH_URL na Vercel com exatamente esse valor ` +
      `(ou troque a URL no console para ${input.base}).`
    );
  }

  const cabecalho =
    `Assinatura não confere com nenhuma URL plausível — então o problema é a chave, não o endereço. ` +
    `Esperada começa com ${input.verificacao.esperadaPrefixo}, recebida com ${input.verificacao.recebidaPrefixo || "(vazia)"}. `;

  return (
    cabecalho +
    (input.origem === "api"
      ? "Está assinando com SHOPEE_PARTNER_KEY, a chave da API — mas o console gera uma Live Push Partner Key " +
        "própria. Clique em Generate lá e configure SHOPEE_PUSH_PARTNER_KEY na Vercel."
      : "Confira se a SHOPEE_PUSH_PARTNER_KEY é exatamente a Live Push Partner Key do console, sem espaços " +
        "sobrando, e se foi salva no ambiente Production.")
  );
}

async function registrar(dados: {
  externalEventId: string;
  eventType: string;
  payload: string;
  signatureValid: boolean;
  processingError?: string;
  workspaceId?: string;
  marketplaceAccountId?: string;
}) {
  return prisma.webhookEvent.upsert({
    where: { marketplace_externalEventId: { marketplace: "SHOPEE", externalEventId: dados.externalEventId } },
    update: { processingError: dados.processingError ?? null },
    create: {
      marketplace: "SHOPEE",
      externalEventId: dados.externalEventId,
      eventType: dados.eventType,
      // Guardado como texto cru de propósito: é o que permite reconferir uma
      // assinatura depois, o que um JSON reserializado não permitiria.
      payload: { raw: dados.payload },
      signatureValid: dados.signatureValid,
      processingError: dados.processingError ?? null,
      workspaceId: dados.workspaceId,
      marketplaceAccountId: dados.marketplaceAccountId,
    },
  });
}

/**
 * Busca e grava um único pedido — duas chamadas, detalhe e escrow.
 *
 * Mesma gravação da importação, pelo mesmo motivo de sempre: dois caminhos
 * calculando taxa e lucro é garantia de divergirem no dia em que o número
 * importa (§60).
 */
async function trazerPedido(
  conta: NonNullable<Awaited<ReturnType<typeof prisma.marketplaceAccount.findFirst>>>,
  orderSn: string,
) {
  const env = getIntegrationEnv();
  const provider = new ShopeeProvider(
    env.SHOPEE_PARTNER_ID ?? "",
    env.SHOPEE_PARTNER_KEY ?? "",
    env.SHOPEE_REDIRECT_URL ?? "",
    env.SHOPEE_ENV ?? "live",
    env.SHOPEE_KEY_ENCODING ?? "raw",
  );

  const credenciais = await resolveFreshCredentials({
    accountId: conta.id,
    externalShopId: conta.externalShopId,
    provider,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
  });

  const pedidos = await provider.fetchOrdersByIds(credenciais, [orderSn]);
  if (pedidos.length === 0) return;

  const cache = createSyncCache();
  const dias = new Set<string>();
  for (const pedido of pedidos) {
    await upsertNormalizedOrder(conta, pedido, cache);
    dias.add(pedido.orderedAt.toISOString().slice(0, 10));
  }
  await recomputeMetricsForDays(conta.workspaceId, [...dias]);
}
