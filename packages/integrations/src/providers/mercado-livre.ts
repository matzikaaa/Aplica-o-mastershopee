import type { MarketplaceProvider, FetchPage } from "../provider";
import {
  MarketplaceApiError,
  MarketplaceNotImplementedError,
  type NormalizedOrder,
  type NormalizedProduct,
  type OAuthTokenResult,
  type ProviderCredentials,
  type SyncCursor,
} from "../types";

/**
 * Mercado Livre Developers (Brasil) — official docs:
 * https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br
 *
 * OAuth 2.0 authorization-code flow, docs:
 * https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
 *
 * PENDING before this adapter can run against real data:
 *   - MERCADOLIVRE_APP_ID / MERCADOLIVRE_CLIENT_SECRET (create an app in
 *     https://developers.mercadolivre.com.br/devcenter)
 *   - MERCADOLIVRE_REDIRECT_URI must match the app's registered callback URL exactly
 *
 * Known limitations (do not paper over — surface to the user, §3):
 *   - Ad spend/ROAS requires the separate Mercado Ads (Product Ads) API,
 *     which needs additional partner approval beyond the base app. Until
 *     that access is granted, fetchAdCampaigns/fetchAdSpend throw
 *     MarketplaceNotImplementedError rather than return fabricated numbers.
 *   - ML does not sign webhook payloads with HMAC. Instead it POSTs a
 *     `{ resource, topic, user_id }` pointer and the receiver must fetch
 *     that resource with its own access token — treat "signature valid"
 *     as "resource fetch succeeded with our token for the subscribed user".
 */

const AUTH_BASE_URL = "https://auth.mercadolivre.com.br/authorization";
const API_BASE_URL = "https://api.mercadolibre.com";

interface MLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token?: string;
}

interface MLOrderItem {
  item: { id: string; seller_sku?: string; title: string; variation_id?: number };
  quantity: number;
  unit_price: number;
  sale_fee: number;
}

interface MLOrder {
  id: number;
  status: string;
  date_created: string;
  currency_id: string;
  total_amount: number;
  order_items: MLOrderItem[];
  taxes?: { amount?: number };
  shipping?: { cost?: number };
}

const STATUS_MAP: Record<string, NormalizedOrder["status"]> = {
  confirmed: "PAID",
  payment_required: "CREATED",
  payment_in_process: "CREATED",
  partially_paid: "PAID",
  paid: "PAID",
  shipped: "SHIPPED",
  delivered: "DELIVERED",
  cancelled: "CANCELED",
  invalid: "CANCELED",
};

export class MercadoLivreProvider implements MarketplaceProvider {
  readonly marketplace = "MERCADO_LIVRE";
  readonly supportsWebhooks = true;

  constructor(
    private readonly appId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  getAuthorizationUrl(state: string): string {
    const url = new URL(AUTH_BASE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.appId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<OAuthTokenResult> {
    const token = await this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
    });
    const me = await this.fetchJson<{ id: number; nickname: string }>(
      `${API_BASE_URL}/users/me`,
      token.access_token,
    );
    return this.toOAuthResult(token, me.id.toString(), me.nickname);
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    const token = await this.requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    return this.toOAuthResult(token, token.user_id.toString());
  }

  private toOAuthResult(token: MLTokenResponse, shopId: string, shopName?: string): OAuthTokenResult {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      scope: token.scope,
      externalShopId: shopId,
      externalShopName: shopName,
    };
  }

  private async requestToken(params: Record<string, string>): Promise<MLTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.clientSecret,
      ...params,
    });
    const res = await fetch(`${API_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!res.ok) {
      throw new MarketplaceApiError(
        `Falha ao obter token do Mercado Livre (HTTP ${res.status})`,
        "MERCADO_LIVRE",
        res.status,
      );
    }
    return res.json() as Promise<MLTokenResponse>;
  }

  private async fetchJson<T>(url: string, accessToken: string): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new MarketplaceApiError(
        `Chamada à API do Mercado Livre falhou (HTTP ${res.status}): ${url}`,
        "MERCADO_LIVRE",
        res.status,
      );
    }
    return res.json() as Promise<T>;
  }

  async fetchProducts(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
  ): Promise<FetchPage<NormalizedProduct>> {
    const offset = cursor.value ? Number(cursor.value) : 0;
    const limit = 50;
    const search = await this.fetchJson<{ results: string[]; paging: { total: number } }>(
      `${API_BASE_URL}/users/${credentials.externalShopId}/items/search?offset=${offset}&limit=${limit}`,
      credentials.accessToken,
    );

    const items: NormalizedProduct[] = [];
    for (const itemId of search.results) {
      const item = await this.fetchJson<{
        id: string;
        title: string;
        seller_custom_field?: string;
        thumbnail?: string;
      }>(`${API_BASE_URL}/items/${itemId}`, credentials.accessToken);
      items.push({
        externalProductId: item.id,
        sku: item.seller_custom_field ?? item.id,
        title: item.title,
        imageUrl: item.thumbnail,
        raw: item,
      });
    }

    const nextOffset = offset + search.results.length;
    return {
      items,
      nextCursor: { value: String(nextOffset) },
      hasMore: nextOffset < search.paging.total,
    };
  }

  async fetchOrders(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
    updatedAfter?: Date,
  ): Promise<FetchPage<NormalizedOrder>> {
    const offset = cursor.value ? Number(cursor.value) : 0;
    const limit = 50;
    const url = new URL(`${API_BASE_URL}/orders/search`);
    url.searchParams.set("seller", credentials.externalShopId);
    url.searchParams.set("sort", "date_desc");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    if (updatedAfter) {
      // Incremental sync (§36): only orders touched since the last successful run.
      url.searchParams.set("order.date_last_updated.from", updatedAfter.toISOString());
    }

    const search = await this.fetchJson<{ results: MLOrder[]; paging: { total: number } }>(
      url.toString(),
      credentials.accessToken,
    );

    const items = search.results.map((order) => this.normalizeOrder(order));
    const nextOffset = offset + search.results.length;
    return {
      items,
      nextCursor: { value: String(nextOffset) },
      hasMore: nextOffset < search.paging.total,
    };
  }

  private normalizeOrder(order: MLOrder): NormalizedOrder {
    const commission = order.order_items.reduce((sum, i) => sum + (i.sale_fee ?? 0), 0);
    return {
      externalOrderId: String(order.id),
      marketplace: "MERCADO_LIVRE",
      status: STATUS_MAP[order.status] ?? "CREATED",
      orderedAt: new Date(order.date_created),
      currency: order.currency_id,
      grossAmount: order.total_amount.toString(),
      discountAmount: "0",
      shippingChargedToBuyer: "0",
      shippingSubsidizedByMerchant: (order.shipping?.cost ?? 0).toString(),
      commissionAmount: commission.toString(),
      marketplaceFeeAmount: "0",
      taxAmount: (order.taxes?.amount ?? 0).toString(),
      items: order.order_items.map((item) => ({
        externalSku: item.item.seller_sku ?? item.item.id,
        externalProductId: item.item.id,
        externalVariationId: item.item.variation_id?.toString(),
        title: item.item.title,
        quantity: item.quantity,
        unitPrice: item.unit_price.toString(),
        commissionAmount: item.sale_fee.toString(),
        feeAmount: "0",
        taxAmount: "0",
      })),
      raw: order,
    };
  }

  // Mercado Ads (Product Ads) requires separate partner approval — PENDING.
  async fetchAdCampaigns(): Promise<never> {
    throw new MarketplaceNotImplementedError("MERCADO_LIVRE", "fetchAdCampaigns (Mercado Ads API)");
  }

  async fetchAdSpend(): Promise<never> {
    throw new MarketplaceNotImplementedError("MERCADO_LIVRE", "fetchAdSpend (Mercado Ads API)");
  }
}
