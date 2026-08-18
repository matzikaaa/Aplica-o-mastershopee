import type {
  NormalizedAdCampaign,
  NormalizedAdSpendDay,
  NormalizedOrder,
  NormalizedProduct,
  OAuthTokenResult,
  ProviderCredentials,
  SyncCursor,
} from "./types";

export interface FetchPage<T> {
  items: T[];
  nextCursor: SyncCursor;
  hasMore: boolean;
}

/**
 * Contract every marketplace adapter implements (§2: "Crie uma camada de
 * integração/adapter para cada plataforma"). Nothing outside
 * packages/integrations — no dashboard code, no financial engine, no
 * worker job — talks to a marketplace API directly; everything goes
 * through this interface so adding a new marketplace never touches
 * business logic.
 *
 * Ads/webhooks are optional because not every marketplace's public API
 * exposes them (§18: "somente quando os dados estiverem disponíveis").
 */
export interface MarketplaceProvider {
  readonly marketplace: string;

  /** Builds the URL the seller is redirected to for OAuth consent. */
  getAuthorizationUrl(state: string): string;

  /** Exchanges the OAuth callback `code` for tokens. */
  exchangeAuthorizationCode(code: string): Promise<OAuthTokenResult>;

  /** Refreshes an expiring access token. */
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult>;

  fetchProducts(credentials: ProviderCredentials, cursor: SyncCursor): Promise<FetchPage<NormalizedProduct>>;

  fetchOrders(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
    updatedAfter?: Date,
  ): Promise<FetchPage<NormalizedOrder>>;

  /** Returns null capabilities (not thrown errors) when the marketplace has no public Ads API — §18. */
  fetchAdCampaigns?(credentials: ProviderCredentials): Promise<NormalizedAdCampaign[]>;
  fetchAdSpend?(
    credentials: ProviderCredentials,
    from: Date,
    to: Date,
  ): Promise<NormalizedAdSpendDay[]>;

  /** True when this provider has an officially documented webhook mechanism the app subscribes to (§35). */
  supportsWebhooks: boolean;
  verifyWebhookSignature?(rawBody: string, headers: Record<string, string>): boolean;
}

export interface ProviderCapabilities {
  products: boolean;
  orders: boolean;
  ads: boolean;
  webhooks: boolean;
}
