import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isWhatsappConfigured,
  normalizePhone,
  sanitizeTemplateParam,
  sendWhatsappAlert,
  sendWhatsappTemplate,
} from "../whatsapp";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("sanitizeTemplateParam — limites da Meta", () => {
  it("colapsa quebras de linha, que a Meta recusa dentro de variável", () => {
    expect(sanitizeTemplateParam("Saco de lixo\n10L")).toBe("Saco de lixo 10L");
    expect(sanitizeTemplateParam("a\r\nb\tc")).toBe("a b c");
  });

  it("colapsa sequências longas de espaço, também recusadas", () => {
    expect(sanitizeTemplateParam("Kit     2 rolos")).toBe("Kit 2 rolos");
  });

  it("não descarta o valor — um número nunca some da mensagem", () => {
    expect(sanitizeTemplateParam("  R$ 1.234,56  ")).toBe("R$ 1.234,56");
  });
});

describe("normalizePhone", () => {
  it("deixa só dígitos, como a API espera", () => {
    expect(normalizePhone("+55 (11) 99999-9999")).toBe("5511999999999");
  });
});

describe("isWhatsappConfigured", () => {
  it("exige token e número — meia configuração não é configuração", () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "t";
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(isWhatsappConfigured()).toBe(false);
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    expect(isWhatsappConfigured()).toBe(true);
  });
});

describe("sendWhatsappTemplate", () => {
  it("monta o corpo com as variáveis na ordem declarada", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    const spy = mockFetch(200, { messages: [{ id: "wamid.abc" }] });

    const id = await sendWhatsappTemplate("+55 11 99999-9999", {
      name: "mastershopee_daily_report",
      language: "pt_BR",
      params: ["Archi Store", "R$ 1.000,00"],
    });

    expect(id).toBe("wamid.abc");
    const body = JSON.parse(spy.mock.calls[0]![1].body as string);
    expect(body.type).toBe("template");
    expect(body.to).toBe("5511999999999");
    expect(body.template.name).toBe("mastershopee_daily_report");
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Archi Store",
      "R$ 1.000,00",
    ]);
  });

  it("propaga a mensagem de erro da Meta, que é o que aponta a correção", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    mockFetch(400, { error: { message: "Template name does not exist in the translation" } });

    await expect(
      sendWhatsappTemplate("5511999999999", { name: "errado", language: "pt_BR", params: [] }),
    ).rejects.toThrow(/Template name does not exist/);
  });
});

describe("sendWhatsappAlert — proativo exige template", () => {
  it("usa template quando há um configurado", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    const spy = mockFetch(200, { messages: [{ id: "wamid.1" }] });

    const result = await sendWhatsappAlert("5511999999999", "meu_template", ["a"], "texto de fallback");

    expect(result.via).toBe("template");
    expect(JSON.parse(spy.mock.calls[0]![1].body as string).type).toBe("template");
  });

  it("cai para texto livre só quando não há template, e diz que foi por ali", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    const spy = mockFetch(200, { messages: [{ id: "wamid.2" }] });

    const result = await sendWhatsappAlert("5511999999999", "", ["a"], "texto de fallback");

    expect(result.via).toBe("text");
    const body = JSON.parse(spy.mock.calls[0]![1].body as string);
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("texto de fallback");
  });

  it("sem template, fora da janela de 24h, o erro real da Meta chega a quem lê", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    mockFetch(400, {
      error: { message: "Message failed to send because more than 24 hours have passed" },
    });

    await expect(sendWhatsappAlert("5511999999999", "", [], "oi")).rejects.toThrow(/24 hours/);
  });
});
