import { NextResponse } from "next/server";
import {
  createSyncCache,
  prisma,
  recomputeMetricsForDays,
  resolveFreshCredentials,
  upsertNormalizedOrder,
} from "@mastershopee/database";
import {
  SHOPEE_PUSH_CODE,
  ShopeeProvider,
  decryptSecret,
  encryptSecret,
  parseShopeePush,
  pedidoDoPush,
  verifyShopeePush,
} from "@mastershopee/integrations";
import { getIntegrationEnv } from "@/lib/integration-env";
import { shopeePushUrl } from "@/lib/shopee-push-url";

export const maxDuration = 30;

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
  if (!env.SHOPEE_PARTNER_KEY) {
    return NextResponse.json({ error: "Shopee não configurada neste ambiente." }, { status: 503 });
  }

  const verificacao = verifyShopeePush({
    pushUrl: shopeePushUrl(),
    rawBody,
    authorization: request.headers.get("authorization"),
    partnerKey: env.SHOPEE_PARTNER_KEY,
    encoding: env.SHOPEE_KEY_ENCODING ?? "raw",
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
      processingError:
        `Assinatura não confere. Esperada começa com ${verificacao.esperadaPrefixo}, ` +
        `recebida com ${verificacao.recebidaPrefixo || "(vazia)"}. ` +
        `Base usada: ${shopeePushUrl()} — confira se é exatamente a URL cadastrada no console da Shopee.`,
    });
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
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

  try {
    if (envelope.code === SHOPEE_PUSH_CODE.DESAUTORIZACAO && conta) {
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
    } else if (envelope.code === SHOPEE_PUSH_CODE.STATUS_DO_PEDIDO && conta && pedido) {
      await trazerPedido(conta, pedido);
    }

    await prisma.webhookEvent.update({
      where: { id: evento.id },
      data: { processedAt: new Date(), processingError: null },
    });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: evento.id },
      data: { processingError: err instanceof Error ? err.message : "falha ao processar" },
    });
  }

  return NextResponse.json({ ok: true });
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
