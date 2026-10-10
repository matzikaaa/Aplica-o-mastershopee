import { describe, expect, it } from "vitest";
import { diasRestantesDeTeste, hasDashboardAccess, statusEfetivo } from "../subscription-state";

const AGORA = new Date("2026-10-10T12:00:00Z");
const dias = (n: number) => new Date(AGORA.getTime() + n * 24 * 3600 * 1000);

describe("fim do teste grátis", () => {
  it("teste dentro do prazo continua com acesso", () => {
    const s = { status: "trialing" as const, trialEndsAt: dias(3) };
    expect(statusEfetivo(s, AGORA)).toBe("trialing");
    expect(hasDashboardAccess(statusEfetivo(s, AGORA))).toBe(true);
  });

  it("teste vencido perde o acesso, mesmo com o status gravado ainda como trialing", () => {
    // O defeito: nada atualizava a linha, e `trialing` gravado valia para
    // sempre. A data decide, não o que ficou escrito.
    const s = { status: "trialing" as const, trialEndsAt: dias(-1) };
    expect(statusEfetivo(s, AGORA)).toBe("expired");
    expect(hasDashboardAccess(statusEfetivo(s, AGORA))).toBe(false);
  });

  it("vence no instante exato do fim", () => {
    expect(statusEfetivo({ status: "trialing", trialEndsAt: AGORA }, AGORA)).toBe("expired");
  });

  it("teste administrado pelo Stripe não é encerrado aqui", () => {
    // Com assinatura no provedor, quem decide é o webhook; vencer localmente
    // bloquearia alguém que o Stripe ainda considera em teste.
    const s = { status: "trialing" as const, trialEndsAt: dias(-1), providerSubscriptionId: "sub_123" };
    expect(statusEfetivo(s, AGORA)).toBe("trialing");
  });

  it("não mexe em quem já paga", () => {
    expect(statusEfetivo({ status: "active", trialEndsAt: dias(-30) }, AGORA)).toBe("active");
    expect(statusEfetivo({ status: "past_due", trialEndsAt: null }, AGORA)).toBe("past_due");
  });

  it("teste sem data de fim não vence sozinho", () => {
    expect(statusEfetivo({ status: "trialing", trialEndsAt: null }, AGORA)).toBe("trialing");
  });
});

describe("dias restantes do teste", () => {
  it("arredonda para cima: meio dia restante ainda é um dia", () => {
    expect(diasRestantesDeTeste({ status: "trialing", trialEndsAt: new Date(AGORA.getTime() + 12 * 3600 * 1000) }, AGORA)).toBe(1);
    expect(diasRestantesDeTeste({ status: "trialing", trialEndsAt: dias(3) }, AGORA)).toBe(3);
  });

  it("fora de teste, ou com teste vencido, devolve null", () => {
    expect(diasRestantesDeTeste({ status: "active", trialEndsAt: dias(3) }, AGORA)).toBeNull();
    expect(diasRestantesDeTeste({ status: "trialing", trialEndsAt: dias(-1) }, AGORA)).toBeNull();
  });
});
