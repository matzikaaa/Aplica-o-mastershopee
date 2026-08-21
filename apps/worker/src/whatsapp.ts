/**
 * Re-export of the shared WhatsApp client, which lives in
 * @mastershopee/integrations so the web app can send the verification
 * message through exactly the same code path the scheduler uses (§60).
 */
export {
  WHATSAPP_NOT_CONFIGURED,
  isWhatsappConfigured,
  sendWhatsappAlert,
  sendWhatsappTemplate,
  sendWhatsappText,
  whatsappTemplates,
} from "@mastershopee/integrations";
