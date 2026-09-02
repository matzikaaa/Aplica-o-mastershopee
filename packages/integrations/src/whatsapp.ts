/**
 * WhatsApp Business Platform (Cloud API) sender.
 * https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * The rule that shapes this whole file: Meta only allows **free-form text**
 * inside the 24-hour window that opens when the person messages the business
 * number. Anything the system starts on its own — a 7:30am report, a
 * low-stock warning at 2pm — is business-initiated and must go out as an
 * approved **template**, or the API rejects it.
 *
 * So the alert paths use templates and the text sender exists only for
 * replies inside the window. Sending text proactively would fail in
 * production while looking fine in a test where someone had just messaged
 * the number (§96 — the failure has to be visible, not situational).
 */

export interface WhatsappTemplateMessage {
  /** Template name exactly as approved in the Meta dashboard. */
  name: string;
  /** BCP-47 code of the approved template, e.g. "pt_BR". */
  language: string;
  /** Body variables, in the order the template declares {{1}}, {{2}}, … */
  params: string[];
}

export const WHATSAPP_NOT_CONFIGURED =
  "WhatsApp Business Platform não configurado (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID pendentes).";

export function isWhatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Names of the templates this app expects, overridable per deployment. */
export const whatsappTemplates = {
  dailyReport: () => process.env.WHATSAPP_TEMPLATE_DAILY_REPORT ?? "",
  /**
   * Resumo da manhã: resultado do dia anterior **e** estoque, num template
   * só. São 7 parâmetros — os 6 do relatório mais o placar de estoque.
   *
   * Existe separado de `dailyReport` porque template aprovado pela Meta tem
   * número fixo de parâmetros: acrescentar o sétimo ao template existente
   * exigiria reaprovação e quebraria quem já usa o de 6. Quando este não
   * está configurado, o envio cai no de 6 e o estoque fica só no texto.
   */
  morningBrief: () => process.env.WHATSAPP_TEMPLATE_MORNING ?? "",
  lowStock: () => process.env.WHATSAPP_TEMPLATE_LOW_STOCK ?? "",
  language: () => process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "pt_BR",
};

/**
 * Meta rejects newlines, tabs and runs of 4+ spaces inside template
 * parameters. Values are collapsed rather than dropped so a number never
 * silently disappears from a message.
 */
export function sanitizeTemplateParam(value: string): string {
  return value.replace(/[\n\r\t]+/g, " ").replace(/\s{4,}/g, " ").trim();
}

/** Digits only — Meta expects the number in E.164 without the leading "+". */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Overridable so the send path can be exercised against a stub, and so a
 * deployment behind an outbound proxy can point at it. Defaults to Meta.
 */
function apiBaseUrl(): string {
  return process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com/v21.0";
}

async function post(body: unknown): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    // Meta's own message is far more useful than any wrapper we could write
    // ("template name does not exist", "24 hours have passed"), so it is
    // surfaced verbatim to whoever is reading the failure.
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; error_data?: { details?: string } } };
      detail = parsed.error?.error_data?.details ?? parsed.error?.message ?? raw;
    } catch {
      // keep the raw body
    }
    throw new Error(`WhatsApp API ${res.status}: ${detail}`);
  }

  const data = JSON.parse(raw) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? "unknown";
}

/** Business-initiated message. This is what every alert and report must use. */
export async function sendWhatsappTemplate(to: string, template: WhatsappTemplateMessage): Promise<string> {
  return post({
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components: template.params.length
        ? [
            {
              type: "body",
              parameters: template.params.map((p) => ({ type: "text", text: sanitizeTemplateParam(p) })),
            },
          ]
        : [],
    },
  });
}

/**
 * Free-form text. Only valid inside the 24-hour window opened by the
 * recipient — outside it Meta returns error 131047 and nothing is delivered.
 */
export async function sendWhatsappText(to: string, text: string): Promise<string> {
  return post({
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "text",
    text: { body: text },
  });
}

export interface WhatsappSendResult {
  messageId: string;
  /** Which route actually delivered it, so the caller can report the truth. */
  via: "template" | "text";
}

/**
 * Send an alert the system decided to send.
 *
 * Prefers the approved template. Falls back to free-form text only when no
 * template is configured — that path works while the operator is inside the
 * 24-hour window and fails loudly outside it, which is the honest behaviour:
 * a deployment without templates genuinely cannot send proactive messages,
 * and should find that out from a real error rather than from silence.
 */
export async function sendWhatsappAlert(
  to: string,
  templateName: string,
  params: string[],
  fallbackText: string,
): Promise<WhatsappSendResult> {
  if (templateName) {
    const messageId = await sendWhatsappTemplate(to, {
      name: templateName,
      language: whatsappTemplates.language(),
      params,
    });
    return { messageId, via: "template" };
  }
  return { messageId: await sendWhatsappText(to, fallbackText), via: "text" };
}
