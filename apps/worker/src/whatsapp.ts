/**
 * WhatsApp Business Platform (Cloud API) sender, shared by the daily report
 * and the low-stock alert — https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * PENDING: WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID require Meta
 * Business verification and an approved message template. Callers must check
 * `isWhatsappConfigured()` first and record an honest "not configured"
 * failure instead of pretending a message went out (§96).
 */

export function isWhatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export const WHATSAPP_NOT_CONFIGURED =
  "WhatsApp Business Platform não configurado (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID pendentes).";

export async function sendWhatsappMessage(toPhoneNumber: string, text: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhoneNumber.replace(/\D/g, ""),
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API respondeu ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? "unknown";
}
