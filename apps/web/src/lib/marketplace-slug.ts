import type { MarketplaceType } from "@mastershopee/shared";

export const SLUG_TO_MARKETPLACE: Record<string, MarketplaceType> = {
  shopee: "SHOPEE",
  mercadolivre: "MERCADO_LIVRE",
  shein: "SHEIN",
  tiktokshop: "TIKTOK_SHOP",
};

export const MARKETPLACE_TO_SLUG: Record<MarketplaceType, string> = {
  SHOPEE: "shopee",
  MERCADO_LIVRE: "mercadolivre",
  SHEIN: "shein",
  TIKTOK_SHOP: "tiktokshop",
};
