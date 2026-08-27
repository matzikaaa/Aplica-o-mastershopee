export * from "./provider";
export * from "./types";
export * from "./credentials";
export * from "./rate-limiter";
export * from "./registry";
export * from "./providers/mercado-livre";
export * from "./providers/shopee";
export * from "./providers/shopee-key";
export * from "./providers/shein";
export * from "./providers/tiktok-shop";

export {
  WHATSAPP_NOT_CONFIGURED,
  isWhatsappConfigured,
  normalizePhone,
  sanitizeTemplateParam,
  sendWhatsappAlert,
  sendWhatsappTemplate,
  sendWhatsappText,
  whatsappTemplates,
  type WhatsappSendResult,
  type WhatsappTemplateMessage,
} from "./whatsapp";

export { ShopeeProvider, type ShopeeDiagnosis, type ShopeeSignAttempt } from "./providers/shopee";
export { shopeeKeyCandidates, resolveShopeeKey, type ShopeeKeyEncoding } from "./providers/shopee-key";
