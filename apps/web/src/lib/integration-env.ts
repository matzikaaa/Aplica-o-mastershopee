import type { IntegrationEnv } from "@mastershopee/integrations";

export function getIntegrationEnv(): IntegrationEnv {
  return {
    SHOPEE_PARTNER_ID: process.env.SHOPEE_PARTNER_ID,
    SHOPEE_PARTNER_KEY: process.env.SHOPEE_PARTNER_KEY,
    SHOPEE_REDIRECT_URL: process.env.SHOPEE_REDIRECT_URL,
    MERCADOLIVRE_APP_ID: process.env.MERCADOLIVRE_APP_ID,
    MERCADOLIVRE_CLIENT_SECRET: process.env.MERCADOLIVRE_CLIENT_SECRET,
    MERCADOLIVRE_REDIRECT_URI: process.env.MERCADOLIVRE_REDIRECT_URI,
    TIKTOKSHOP_APP_KEY: process.env.TIKTOKSHOP_APP_KEY,
    TIKTOKSHOP_APP_SECRET: process.env.TIKTOKSHOP_APP_SECRET,
    TIKTOKSHOP_REDIRECT_URI: process.env.TIKTOKSHOP_REDIRECT_URI,
  };
}
