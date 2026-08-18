import type { MarketplaceType } from "@mastershopee/shared";
import type { MarketplaceProvider } from "./provider";
import { MercadoLivreProvider } from "./providers/mercado-livre";
import { ShopeeProvider } from "./providers/shopee";
import { SheinProvider } from "./providers/shein";
import { TikTokShopProvider } from "./providers/tiktok-shop";

export interface IntegrationEnv {
  SHOPEE_PARTNER_ID?: string;
  SHOPEE_PARTNER_KEY?: string;
  SHOPEE_REDIRECT_URL?: string;
  MERCADOLIVRE_APP_ID?: string;
  MERCADOLIVRE_CLIENT_SECRET?: string;
  MERCADOLIVRE_REDIRECT_URI?: string;
  TIKTOKSHOP_APP_KEY?: string;
  TIKTOKSHOP_APP_SECRET?: string;
  TIKTOKSHOP_REDIRECT_URI?: string;
}

/**
 * Factory mapping a MarketplaceType to its provider adapter (§2 — this is
 * the only place that needs to change to add a new marketplace, plus the
 * provider file itself). Missing env vars still return a working instance
 * so the app can render "not connected — configuração pendente" instead
 * of crashing; the OAuth call itself will fail loudly if actually invoked
 * without real credentials.
 */
export function createProvider(type: MarketplaceType, env: IntegrationEnv): MarketplaceProvider {
  switch (type) {
    case "SHOPEE":
      return new ShopeeProvider(
        env.SHOPEE_PARTNER_ID ?? "",
        env.SHOPEE_PARTNER_KEY ?? "",
        env.SHOPEE_REDIRECT_URL ?? "",
      );
    case "MERCADO_LIVRE":
      return new MercadoLivreProvider(
        env.MERCADOLIVRE_APP_ID ?? "",
        env.MERCADOLIVRE_CLIENT_SECRET ?? "",
        env.MERCADOLIVRE_REDIRECT_URI ?? "",
      );
    case "SHEIN":
      return new SheinProvider();
    case "TIKTOK_SHOP":
      return new TikTokShopProvider(
        env.TIKTOKSHOP_APP_KEY ?? "",
        env.TIKTOKSHOP_APP_SECRET ?? "",
        env.TIKTOKSHOP_REDIRECT_URI ?? "",
      );
  }
}

export function isProviderConfigured(type: MarketplaceType, env: IntegrationEnv): boolean {
  switch (type) {
    case "SHOPEE":
      return Boolean(env.SHOPEE_PARTNER_ID && env.SHOPEE_PARTNER_KEY);
    case "MERCADO_LIVRE":
      return Boolean(env.MERCADOLIVRE_APP_ID && env.MERCADOLIVRE_CLIENT_SECRET);
    case "SHEIN":
      return false; // never configured until SHEIN grants partner API access
    case "TIKTOK_SHOP":
      return Boolean(env.TIKTOKSHOP_APP_KEY && env.TIKTOKSHOP_APP_SECRET);
  }
}
