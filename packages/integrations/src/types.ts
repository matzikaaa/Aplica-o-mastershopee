import type { MarketplaceType } from "@mastershopee/shared";

/**
 * Every marketplace's external order shape is different. Providers never
 * hand raw payloads to the rest of the app — they normalize into this
 * shape first (§86: External Order → Adapter → Normalized Order → Financial Engine).
 */
export interface NormalizedOrder {
  externalOrderId: string;
  marketplace: MarketplaceType;
  status: "CREATED" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELED" | "REFUNDED" | "RETURNED";
  orderedAt: Date;
  currency: string;
  grossAmount: string;
  discountAmount: string;
  shippingChargedToBuyer: string;
  shippingSubsidizedByMerchant: string;
  commissionAmount: string;
  marketplaceFeeAmount: string;
  taxAmount: string;
  items: NormalizedOrderItem[];
  raw: unknown;
}

export interface NormalizedOrderItem {
  externalSku: string;
  externalProductId: string;
  externalVariationId?: string;
  title: string;
  quantity: number;
  unitPrice: string;
  commissionAmount: string;
  feeAmount: string;
  taxAmount: string;
}

export interface NormalizedProduct {
  externalProductId: string;
  externalVariationId?: string;
  sku: string;
  title: string;
  imageUrl?: string;
  raw: unknown;
}

export interface NormalizedAdCampaign {
  externalCampaignId: string;
  name: string;
  status: string;
}

export interface NormalizedAdSpendDay {
  externalCampaignId: string;
  date: string; // YYYY-MM-DD
  spend: string;
  attributedRevenue: string;
  orders: number;
  clicks?: number;
  impressions?: number;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
  externalShopId: string;
  externalShopName?: string;
}

export interface ProviderCredentials {
  accessToken: string;
  refreshToken?: string;
  externalShopId: string;
}

export interface SyncCursor {
  /** Opaque, provider-defined cursor/timestamp used to fetch only what changed since the last sync (§36). */
  value: string | null;
}

export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    readonly marketplace: MarketplaceType,
    readonly httpStatus?: number,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "MarketplaceApiError";
  }
}

export class MarketplaceNotImplementedError extends Error {
  constructor(marketplace: MarketplaceType, capability: string) {
    super(
      `${marketplace}: "${capability}" ainda não está disponível. Consulte packages/integrations/README.md ` +
        "para o status de implementação e as credenciais pendentes.",
    );
    this.name = "MarketplaceNotImplementedError";
  }
}
