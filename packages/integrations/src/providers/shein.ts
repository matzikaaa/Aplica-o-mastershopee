import type { MarketplaceProvider, FetchPage } from "../provider";
import {
  MarketplaceNotImplementedError,
  type NormalizedOrder,
  type NormalizedProduct,
  type OAuthTokenResult,
} from "../types";

/**
 * SHEIN — Open Platform / Seller API.
 *
 * STATUS: NOT IMPLEMENTED. Unlike Shopee/Mercado Livre/TikTok Shop, SHEIN
 * does not publish a self-serve developer portal with public API
 * documentation as of this implementation. Seller/marketplace API access
 * is granted case-by-case to approved partners, and the exact
 * authentication scheme, endpoints and available fields are not publicly
 * verifiable — implementing this adapter with invented endpoints would
 * violate the project's explicit "never invent APIs" requirement (§3).
 *
 * This class exists so:
 *   1. SHEIN shows up correctly in the provider registry and the
 *      Integrations page (§33) as "not connected" with an honest reason.
 *   2. Once SHEIN partner credentials and API documentation are obtained,
 *      implementing this file is a drop-in change — no other part of the
 *      app needs to change, because everything depends on the
 *      MarketplaceProvider interface, not on this class directly.
 *
 * PENDING: SHEIN partner/seller API approval and official documentation.
 * Until then, every method throws MarketplaceNotImplementedError instead
 * of returning fabricated data.
 */
export class SheinProvider implements MarketplaceProvider {
  readonly marketplace = "SHEIN";
  readonly supportsWebhooks = false;

  getAuthorizationUrl(): string {
    throw new MarketplaceNotImplementedError("SHEIN", "OAuth authorization (pending partner API access)");
  }

  async exchangeAuthorizationCode(): Promise<OAuthTokenResult> {
    throw new MarketplaceNotImplementedError("SHEIN", "exchangeAuthorizationCode");
  }

  async refreshAccessToken(): Promise<OAuthTokenResult> {
    throw new MarketplaceNotImplementedError("SHEIN", "refreshAccessToken");
  }

  async fetchProducts(): Promise<FetchPage<NormalizedProduct>> {
    throw new MarketplaceNotImplementedError("SHEIN", "fetchProducts");
  }

  async fetchOrders(): Promise<FetchPage<NormalizedOrder>> {
    throw new MarketplaceNotImplementedError("SHEIN", "fetchOrders");
  }
}
