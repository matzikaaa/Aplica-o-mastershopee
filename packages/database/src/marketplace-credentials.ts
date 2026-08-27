import { prisma } from "./index";

/**
 * Credenciais de marketplace prontas para uso, renovando o access token
 * quando ele está perto de vencer.
 *
 * O token da Shopee vale 4 horas. Isso vivia só dentro do job do worker, e o
 * worker não está hospedado — então tudo que roda pela aplicação web usava o
 * token gravado até ele morrer, e a partir daí toda chamada voltava
 * "invalid_access_token" sem nada que explicasse o que fazer.
 *
 * As funções de cifra entram por parâmetro de propósito: este pacote não
 * conhece `@mastershopee/integrations`, e inverter a dependência colocaria o
 * Prisma dentro do pacote de integrações.
 */
export interface RefreshableProvider {
  refreshAccessToken(refreshToken: string, shopId?: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt?: Date;
  }>;
}

export interface ResolveCredentialsInput {
  accountId: string;
  externalShopId: string;
  provider: RefreshableProvider;
  encrypt: (plaintext: string) => string;
  decrypt: (packed: string) => string;
  /** Margem antes do vencimento. Renovar em cima da hora perde a corrida. */
  refreshWindowMs?: number;
}

export interface ResolvedCredentials {
  accessToken: string;
  refreshToken?: string;
  externalShopId: string;
  refreshed: boolean;
}

export class MissingCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialsError";
  }
}

export async function resolveFreshCredentials(
  input: ResolveCredentialsInput,
): Promise<ResolvedCredentials> {
  const credential = await prisma.marketplaceCredential.findUnique({
    where: { marketplaceAccountId: input.accountId },
  });
  if (!credential) {
    throw new MissingCredentialsError(
      "A conta existe mas está sem token salvo — a autorização não foi concluída. Conecte novamente.",
    );
  }

  const accessToken = input.decrypt(credential.encryptedAccessToken);
  const refreshToken = credential.encryptedRefreshToken
    ? input.decrypt(credential.encryptedRefreshToken)
    : undefined;

  const window = input.refreshWindowMs ?? 5 * 60 * 1000;
  const expiring =
    credential.accessTokenExpiresAt !== null &&
    credential.accessTokenExpiresAt < new Date(Date.now() + window);

  if (!expiring) {
    return { accessToken, refreshToken, externalShopId: input.externalShopId, refreshed: false };
  }

  if (!refreshToken) {
    throw new MissingCredentialsError(
      "O acesso à Shopee expirou e não há refresh token guardado para renovar. Reconecte a loja em Integrações.",
    );
  }

  const renewed = await input.provider.refreshAccessToken(refreshToken, input.externalShopId);

  await prisma.marketplaceCredential.update({
    where: { marketplaceAccountId: input.accountId },
    data: {
      encryptedAccessToken: input.encrypt(renewed.accessToken),
      // A Shopee devolve um refresh token novo a cada renovação e invalida o
      // anterior. Guardar só o access token deixaria a próxima renovação sem
      // chave — e o vendedor teria que reconectar a cada 4 horas.
      encryptedRefreshToken: renewed.refreshToken ? input.encrypt(renewed.refreshToken) : undefined,
      accessTokenExpiresAt: renewed.accessTokenExpiresAt,
      rotatedAt: new Date(),
    },
  });

  return {
    accessToken: renewed.accessToken,
    refreshToken: renewed.refreshToken ?? refreshToken,
    externalShopId: input.externalShopId,
    refreshed: true,
  };
}
