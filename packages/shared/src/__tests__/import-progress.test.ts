import { describe, expect, it } from "vitest";
import {
  JANELA_SEGUNDOS,
  fimDaJanela,
  lerEstado,
  novoEstado,
  percentualConcluido,
  serializarEstado,
  totalDeJanelas,
} from "../import-progress";

const AGORA = 1_780_000_000;
const dias = (n: number) => n * 24 * 3600;

describe("plano de janelas", () => {
  it("divide o período pedido em janelas de 15 dias", () => {
    expect(totalDeJanelas(AGORA - dias(120), AGORA)).toBe(8);
    expect(totalDeJanelas(AGORA - dias(15), AGORA)).toBe(1);
  });

  it("arredonda para cima: um resto de histórico ainda é uma janela a varrer", () => {
    expect(totalDeJanelas(AGORA - dias(16), AGORA)).toBe(2);
  });

  it("nunca devolve zero, nem para um período que já terminou", () => {
    // Zero janelas faria a barra dividir por zero e o laço parar antes de
    // consultar qualquer coisa.
    expect(totalDeJanelas(AGORA, AGORA)).toBe(1);
    expect(totalDeJanelas(AGORA + dias(5), AGORA)).toBe(1);
  });

  it("não deixa a janela passar do presente", () => {
    const estado = { ...novoEstado(AGORA - dias(10)), j: 0 };
    expect(fimDaJanela(estado, AGORA)).toBe(AGORA);
  });

  it("fecha a janela no múltiplo de 15 dias quando ela cabe no passado", () => {
    const ini = AGORA - dias(120);
    expect(fimDaJanela({ ...novoEstado(ini), j: 2 }, AGORA)).toBe(ini + 3 * JANELA_SEGUNDOS);
  });
});

describe("percentual", () => {
  const ini = AGORA - dias(120); // 8 janelas

  it("começa em zero e conta só janelas terminadas", () => {
    expect(percentualConcluido({ ...novoEstado(ini), j: 0 }, AGORA, false)).toBe(0);
    expect(percentualConcluido({ ...novoEstado(ini), j: 4 }, AGORA, false)).toBe(50);
  });

  it("não chega a 100 enquanto a importação não acabou", () => {
    // Barra cheia com trabalho em andamento é a mentira que faz o vendedor
    // parar de acreditar no indicador.
    expect(percentualConcluido({ ...novoEstado(ini), j: 8 }, AGORA, false)).toBe(99);
  });

  it("chega a 100 só quando o trabalho termina", () => {
    expect(percentualConcluido({ ...novoEstado(ini), j: 8 }, AGORA, true)).toBe(100);
  });
});

describe("leitura do estado gravado", () => {
  it("vai e volta sem perder nada", () => {
    const estado = { ...novoEstado(AGORA - dias(45)), j: 2, c: "abc" };
    expect(lerEstado(serializarEstado(estado))).toEqual(estado);
  });

  it("recusa o cursor do formato antigo em vez de interpretá-lo errado", () => {
    // "epoch|cursor" não guardava o início do histórico. Lido como válido,
    // produziria um total de janelas inventado e uma barra que mente.
    expect(lerEstado("1779000000|XYZ")).toBeNull();
  });

  it("recusa lixo, versão desconhecida e ausência", () => {
    expect(lerEstado(null)).toBeNull();
    expect(lerEstado("")).toBeNull();
    expect(lerEstado("{nao é json")).toBeNull();
    expect(lerEstado(JSON.stringify({ v: 1, ini: AGORA }))).toBeNull();
    expect(lerEstado(JSON.stringify({ v: 2, ini: "ontem" }))).toBeNull();
  });

  it("tolera campos faltando num estado válido", () => {
    expect(lerEstado(JSON.stringify({ v: 2, ini: AGORA }))).toEqual({ v: 2, ini: AGORA, j: 0, c: "" });
  });
});
