import { createHmac } from "node:crypto";
import type { MarketplaceProvider, FetchPage } from "../provider";
import {
  MarketplaceApiError,
  MarketplaceNotImplementedError,
  type NormalizedOrder,
  type NormalizedProduct,
  type OAuthTokenResult,
} from "../types";

/**
 * TikTok Shop Partner Center — official docs: https://partner.tiktokshop.com/docv2
 *
 * STATUS: scaffold only. TikTok Shop's Partner API is versioned aggressively
 * (path segments like `/202309/`, `/202312/` change between releases) and
 * regional availability/onboarding requirements differ by market. Rather
 * than guess a specific version's exact paths and risk shipping wrong
 * endpoints (explicitly forbidden by the project brief, §3), this adapter
 * implements the parts of the contract that are stable — HMAC-SHA256
 * request signing shape and the OAuth handshake pattern — and raises
 * MarketplaceNotImplementedError for data endpoints until:
 *
 * PENDING:
 *   - TIKTOKSHOP_APP_KEY / TIKTOKSHOP_APP_SECRET (TikTok Shop Partner Center
 *     app registration + approval)
 *   - Confirmation of the current API version path and exact endpoint list
 *     for Orders/Products/Ads against the live docs for the target region
 *   - Seller authorization (shop-level OAuth grant)
 */

const AUTH_BASE_URL = "https://services.tiktokshop.com/open/authorize";
const API_BASE_URL = "https://open-api.tiktokglobalshop.com";

export class TikTokShopProvider implements MarketplaceProvider {
  readonly marketplace = "TIKTOK_SHOP";
  readonly supportsWebhooks = true;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly redirectUri: string,
  ) {}

  private sign(path: string, params: Record<string, string>, timestamp: number): string {
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join("");
    const base = `${this.appKey}${path}${sorted}${timestamp}`;
    return createHmac("sha256", this.appSecret).update(base).digest("hex");
  }

  getAuthorizationUrl(state: string): string {
    const url = new URL(AUTH_BASE_URL);
    url.searchParams.set("service_id", this.appKey);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<OAuthTokenResult> {
    const path = "/api/v2/token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { app_key: this.appKey, auth_code: code, grant_type: "authorized_code" };
    const sign = this.sign(path, params, timestamp);
    const url = new URL(API_BASE_URL + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new MarketplaceApiError(
        `Falha ao obter token do TikTok Shop (HTTP ${res.status})`,
        "TIKTOK_SHOP",
        res.status,
      );
    }
    const data = (await res.json()) as {
      data?: { access_token: string; refresh_token: string; access_token_expire_in: number; seller_name?: string };
      code: number;
      message: string;
    };
    if (data.code !== 0 || !data.data) {
      throw new MarketplaceApiError(`TikTok Shop: ${data.message}`, "TIKTOK_SHOP");
    }
    return {
      accessToken: data.data.access_token,
      refreshToken: data.data.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + data.data.access_token_expire_in * 1000),
      externalShopId: data.data.seller_name ?? "unknown",
    };
  }

  async refreshAccessToken(): Promise<OAuthTokenResult> {
    throw new MarketplaceNotImplementedError(
      "TIKTOK_SHOP",
      "refreshAccessToken (pending confirmation of current token-refresh endpoint version)",
    );
  }

  async fetchProducts(): Promise<FetchPage<NormalizedProduct>> {
    throw new MarketplaceNotImplementedError("TIKTOK_SHOP", "fetchProducts");
  }

  async fetchOrders(): Promise<FetchPage<NormalizedOrder>> {
    throw new MarketplaceNotImplementedError("TIKTOK_SHOP", "fetchOrders");
  }

  async fetchAdCampaigns(): Promise<never> {
    throw new MarketplaceNotImplementedError("TIKTOK_SHOP", "fetchAdCampaigns (TikTok Shop Ads API)");
  }

  async fetchAdSpend(): Promise<never> {
    throw new MarketplaceNotImplementedError("TIKTOK_SHOP", "fetchAdSpend (TikTok Shop Ads API)");
  }
}
