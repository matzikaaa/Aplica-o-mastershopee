import { timingSafeEqual } from "node:crypto";
import type { MarketplaceProvider, FetchPage } from "../provider";
import {
  isShopeeKeyFormat,
  resolveShopeeKey,
  shopeeKeyCandidates,
  shopeeKeyFingerprint,
  shopeeSign,
  type ShopeeKeyCandidate,
  type ShopeeKeyEncoding,
} from "./shopee-key";
import {
  normalizeShopeeOrder,
  type ShopeeEscrowRaw,
  type ShopeeOrderDetailRaw,
} from "./shopee-orders";
import {
  MarketplaceApiError,
  MarketplaceNotImplementedError,
  type NormalizedOrder,
  type NormalizedProduct,
  type OAuthTokenResult,
  type ProviderCredentials,
  type SyncCursor,
} from "../types";

/**
 * Shopee Open Platform v2 — official docs: https://open.shopee.com/documents
 *
 * IMPLEMENTED (structure): HMAC-SHA256 request signing, OAuth authorization
 * URL, token exchange/refresh scaffolding, incremental order sync using
 * `update_time_from`/`update_time_to` and the documented 15-day window cap.
 *
 * PENDING before this adapter can talk to real Shopee data:
 *   - SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY — obtained after Shopee Open
 *     Platform partner registration + app approval (open.shopee.com)
 *   - Shop-level authorization (seller must complete the `auth_partner` flow)
 *   - CONFIRM current endpoint paths/params against the live docs before
 *     production use — Shopee versions its Order/Product/Ads APIs and this
 *     scaffold encodes the v2 shape as of this implementation, not a live
 *     contract test against Shopee's servers.
 *
 * Known limitations:
 *   - Ads data requires the separate Shopee Ads API, gated behind
 *     additional approval; fetchAdCampaigns/fetchAdSpend are not
 *     implemented until that access exists.
 */

/** One reading of the partner key, and what Shopee said about it. */
/**
 * O que a resposta da Shopee diz sobre a assinatura — que não é a mesma
 * pergunta que "deu erro?".
 *
 * `invalid_partner_id`, `error_param` e `error_not_found` são recusados
 * *antes* de a assinatura ser conferida: a Shopee não achou o parceiro, ou a
 * chamada nem chegou ao endpoint. Tratar isso como "assinatura aceita"
 * inverte a conclusão de uma sondagem cruzada de ambiente — é exatamente a
 * resposta esperada ao perguntar ao host do ambiente errado.
 */
export type ShopeeSignVerdict = "accepted" | "refused" | "inconclusive";

function signVerdictFor(errorCode: string | null): ShopeeSignVerdict {
  if (!errorCode) return "accepted";
  switch (errorCode) {
    case "error_sign":
      return "refused";
    case "invalid_partner_id":
    case "error_param":
    case "error_not_found":
      return "inconclusive";
    default:
      // Permissão, cota, loja não autorizada: a Shopee só chega nesses
      // depois de validar a assinatura.
      return "accepted";
  }
}

export interface ShopeeSignAttempt {
  encoding: ShopeeKeyEncoding;
  /** Which host this reading was tried against. */
  environment: "test" | "live";
  /** Byte length of the derived key — never the key itself. */
  keyByteLength: number;
  signVerdict: ShopeeSignVerdict;
  shopeeError: string | null;
}

export interface ShopeeDiagnosis {
  ok: boolean;
  environment: "test" | "live";
  host: string;
  redirectUrl: string;
  partnerIdLength: number;
  partnerKeyLength: number;
  /** The reading currently configured via SHOPEE_KEY_ENCODING. */
  keyEncoding: ShopeeKeyEncoding;
  /** Enough of the key to tell Test from Live, never enough to use it. */
  keyFingerprint: string;
  /** Whether the key still looks like `shpk` + 60 hex — catches a mangled paste. */
  keyFormatOk: boolean;
  /**
   * Our clock minus Shopee's, in seconds, taken from their `Date` header.
   * Shopee refuses signatures more than ~5 minutes off, so this either
   * confirms or eliminates clock drift instead of leaving it as a suspicion.
   */
  clockSkewSeconds: number | null;
  /**
   * The environment whose host accepted the signature, when it differs from
   * the configured one — i.e. the credentials belong to the other tier.
   */
  acceptedEnvironment: "test" | "live" | null;
  /**
   * The reading Shopee actually accepted, when the probe found one. Null
   * means every reading was refused — the problem is not the encoding.
   */
  acceptedKeyEncoding: ShopeeKeyEncoding | null;
  /** Every reading tried, in the order tried, with Shopee's answer. */
  signAttempts: ShopeeSignAttempt[];
  /** What we can tell the operator to do about it. */
  problems: string[];
  /** Shopee's own error string, never paraphrased away. */
  shopeeError: string | null;
  shopCount: number | null;
}

/**
 * Shopee's error codes are terse and each points at a different fix, so the
 * translation is a lookup rather than a guess. The raw code travels alongside
 * this text — it is added to, never replaced.
 */
function explainShopeeError(code: string, environment: "test" | "live"): string {
  const other = environment === "test" ? "live" : "test";
  switch (code) {
    case "error_sign":
      return `Assinatura recusada em todas as leituras da chave testadas. Sobram estas causas: o partner_key é do ambiente ${other} (SHOPEE_ENV está em "${environment}"), foi colado incompleto, ou o relógio da máquina está fora do horário real — a assinatura inclui o horário e a Shopee recusa fora de ~5 minutos.`;
    case "error_param":
      return "Parâmetro faltando ou malformado na chamada. Confira partner_id e o redirect cadastrado no console.";
    case "invalid_partner_id":
      return `partner_id não existe neste ambiente. SHOPEE_ENV está em "${environment}" — se as credenciais forem do ambiente ${other}, troque.`;
    case "error_auth":
    case "error_permission":
      return "Credenciais válidas, mas o app não tem permissão para esta API. Confira as APIs liberadas na aba de permissões do console.";
    case "error_not_found":
      return "Endpoint não encontrado — a Shopee versiona as APIs e o caminho pode ter mudado.";
    default:
      return `A Shopee recusou com "${code}". Consulte open.shopee.com/documents para esse código.`;
  }
}

const LIVE_HOST = "https://partner.shopeemobile.com";
const TEST_HOST = "https://partner.test-stable.shopeemobile.com";

export class ShopeeProvider implements MarketplaceProvider {
  readonly marketplace = "SHOPEE";
  readonly supportsWebhooks = true;

  private readonly partnerHost: string;
  private readonly signingKey: Buffer;

  constructor(
    private readonly partnerId: string,
    private readonly partnerKey: string,
    private readonly redirectUrl: string,
    // Shopee issues separate partner_id/partner_key per environment (visible
    // as "Test" vs "Live" in the Open Platform console) — a test partner_id
    // called against the live host (or vice versa) fails with
    // "invalid_partner_id", not a clearer environment-mismatch error.
    env: "test" | "live" = "live",
    // How to read the value the console printed. Default is "raw" (assinar
    // com a string exibida) porque é o comportamento que já existia; o
    // `diagnose` descobre empiricamente qual leitura a Shopee aceita e diz
    // qual valor pôr em SHOPEE_KEY_ENCODING. Ver ./shopee-key.ts.
    private readonly keyEncoding: ShopeeKeyEncoding = "raw",
  ) {
    this.partnerHost = env === "test" ? TEST_HOST : LIVE_HOST;
    this.signingKey = resolveShopeeKey(partnerKey, keyEncoding);
  }

  private buildSignBase(path: string, timestamp: number, accessToken?: string, shopId?: string): string {
    return [this.partnerId, path, timestamp, accessToken, shopId].filter((v) => v !== undefined).join("");
  }

  private sign(path: string, timestamp: number, accessToken?: string, shopId?: string): string {
    return shopeeSign(this.signingKey, this.buildSignBase(path, timestamp, accessToken, shopId));
  }

  /**
   * Shopee push-notification authentication: an HMAC-SHA256 of the request
   * body, keyed by the partner key, sent in the `Authorization` header.
   * NOTE: Shopee's documented scheme signs `url + "|" + body`, not the body
   * alone — the exact callback URL to include must be confirmed against
   * the live docs (or the Partner Center's configured push URL) before
   * this gates real traffic; this is a best-effort implementation flagged
   * per the "confirm against live docs" note above, not a verified contract.
   */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    const provided = headers["authorization"] ?? headers["Authorization"];
    if (!provided || !this.partnerKey) return false;

    const expected = shopeeSign(this.signingKey, rawBody);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Calls a partner-level endpoint that needs no shop authorization, purely
   * to find out whether the credentials and the signature are accepted.
   *
   * This exists because `error_sign` is indistinguishable from a dozen other
   * problems when it surfaces halfway through an OAuth redirect: wrong
   * environment, whitespace pasted into the key, a clock that drifted, a Test
   * partner_id against the Live host. Here the whole request is ours, so the
   * answer comes back in one call with Shopee's own words attached.
   */
  async diagnose(): Promise<ShopeeDiagnosis> {
    const problems: string[] = [];
    if (!this.partnerId) problems.push("SHOPEE_PARTNER_ID não configurado.");
    if (!this.partnerKey) problems.push("SHOPEE_PARTNER_KEY não configurado.");
    if (!this.redirectUrl) problems.push("SHOPEE_REDIRECT_URL não configurado.");

    // Whitespace pasted along with a key is invisible in a .env file and
    // produces exactly the same error as a wrong key.
    if (this.partnerId !== this.partnerId.trim()) problems.push("SHOPEE_PARTNER_ID tem espaço em branco nas pontas.");
    if (this.partnerKey !== this.partnerKey.trim()) problems.push("SHOPEE_PARTNER_KEY tem espaço em branco nas pontas.");
    if (this.partnerId && !/^\d+$/.test(this.partnerId.trim())) {
      problems.push("SHOPEE_PARTNER_ID deveria ser só dígitos — confira se não colou o partner_key no lugar.");
    }

    if (this.partnerKey && !isShopeeKeyFormat(this.partnerKey)) {
      problems.push(
        "SHOPEE_PARTNER_KEY não tem o formato que o console imprime (`shpk` + 60 hexadecimais) — provavelmente veio truncada ou com caractere invisível no meio.",
      );
    }

    const configuredEnvironment = this.partnerHost === TEST_HOST ? ("test" as const) : ("live" as const);
    const base = {
      host: this.partnerHost,
      environment: configuredEnvironment,
      redirectUrl: this.redirectUrl,
      partnerIdLength: this.partnerId.trim().length,
      partnerKeyLength: this.partnerKey.trim().length,
      keyEncoding: this.keyEncoding,
      keyFingerprint: shopeeKeyFingerprint(this.partnerKey),
      keyFormatOk: isShopeeKeyFormat(this.partnerKey),
    };

    const empty = {
      acceptedKeyEncoding: null,
      acceptedEnvironment: null,
      signAttempts: [],
      clockSkewSeconds: null,
    };

    if (problems.length > 0) {
      return { ...base, ...empty, ok: false, problems, shopeeError: null, shopCount: null };
    }

    // A leitura configurada vai primeiro: quando ela já funciona, o
    // diagnóstico custa exatamente uma chamada, como antes.
    const candidates = shopeeKeyCandidates(this.partnerKey);
    const ordered = [
      ...candidates.filter((c) => c.encoding === this.keyEncoding),
      ...candidates.filter((c) => c.encoding !== this.keyEncoding),
    ];

    const attempts: ShopeeSignAttempt[] = [];
    let lastFailure: Omit<ShopeeDiagnosis, keyof typeof empty> | null = null;
    let clockSkewSeconds: number | null = null;
    let reachedShopee = false;

    // Duas rodadas: o host configurado e, só se tudo for recusado lá, o host
    // do outro ambiente. As chaves de Test e de Live têm o mesmo tamanho e o
    // mesmo prefixo, então colar uma no lugar da outra é invisível daqui —
    // mas a Shopee sabe, e uma chamada ao outro host pergunta isso a ela.
    const hosts: { host: string; environment: "test" | "live" }[] = [
      { host: this.partnerHost, environment: configuredEnvironment },
      {
        host: configuredEnvironment === "test" ? LIVE_HOST : TEST_HOST,
        environment: configuredEnvironment === "test" ? "live" : "test",
      },
    ];

    for (const { host, environment } of hosts) {
      for (const candidate of ordered) {
        const result = await this.probeWithKey(candidate, base, host, environment);
        attempts.push(result.attempt);
        clockSkewSeconds ??= result.clockSkewSeconds;
        reachedShopee ||= result.reachedShopee;

        // Só um veredito "accepted" conclui a sondagem. Um inconclusivo não
        // diz nada sobre a chave e seguir nele já produziu uma conclusão
        // invertida uma vez.
        if (result.attempt.signVerdict !== "accepted") {
          if (environment === configuredEnvironment) lastFailure = result.diagnosis;
          continue;
        }

        // A assinatura passou. Se ainda assim veio erro, o problema é outro
        // (permissão, partner_id, endpoint) e insistir com outras leituras
        // ou com o outro host só gastaria chamadas.
        const matches = candidate.encoding === this.keyEncoding && environment === configuredEnvironment;
        const hints: string[] = [];
        if (environment !== configuredEnvironment) {
          hints.push(
            `A Shopee aceitou a assinatura no host de ${environment}, não no de ${configuredEnvironment}: estas credenciais são do ambiente ${environment}. Ajuste SHOPEE_ENV=${environment} ou troque o par partner_id/partner_key pelo de ${configuredEnvironment}.`,
          );
        }
        if (candidate.encoding !== this.keyEncoding) {
          hints.push(
            `A Shopee aceitou a assinatura com a leitura "${candidate.encoding}" da chave, e não com a configurada ("${this.keyEncoding}"). Defina SHOPEE_KEY_ENCODING=${candidate.encoding}.`,
          );
        }

        return {
          ...result.diagnosis,
          // Só é "ok" de verdade quando o que passou é o que a aplicação usa
          // em produção — senão o diagnóstico estaria dizendo que está tudo
          // certo enquanto o sync continua quebrado.
          ok: result.diagnosis.ok && matches,
          problems: [...hints, ...result.diagnosis.problems],
          acceptedKeyEncoding: candidate.encoding,
          acceptedEnvironment: environment,
          signAttempts: attempts,
          clockSkewSeconds,
        };
      }
    }

    return {
      ...(lastFailure ?? { ...base, ok: false, problems: [], shopeeError: "error_sign", shopCount: null }),
      // Se a Shopee nunca respondeu, o relatório de eliminação seria uma
      // mentira: nada foi eliminado, a rede é que não chegou lá.
      problems: reachedShopee
        ? this.explainTotalSignFailure(base, attempts, clockSkewSeconds)
        : (lastFailure?.problems ?? ["Não foi possível alcançar a Shopee."]),
      acceptedKeyEncoding: null,
      acceptedEnvironment: null,
      signAttempts: attempts,
      clockSkewSeconds,
    };
  }

  /**
   * Quando *nenhuma* leitura passa em *nenhum* ambiente, as suspeitas de
   * sempre já foram medidas — repeti-las como possibilidades seria mandar o
   * operador checar o que a sondagem acabou de descartar. Este relatório
   * separa o que foi eliminado do que sobrou.
   */
  private explainTotalSignFailure(
    base: { environment: "test" | "live"; partnerKeyLength: number; keyFormatOk: boolean },
    attempts: ShopeeSignAttempt[],
    clockSkewSeconds: number | null,
  ): string[] {
    const here = attempts.filter((a) => a.environment === base.environment);
    const there = attempts.filter((a) => a.environment !== base.environment);
    const otherEnvironment = base.environment === "live" ? "test" : "live";

    const out: string[] = [];

    // `error_sign` no host configurado é, por si só, uma informação boa: a
    // Shopee só chega a conferir a assinatura depois de encontrar o parceiro.
    const refusedHere = here.some((a) => a.signVerdict === "refused");
    const unknownThere = there.some((a) => (a.shopeeError ?? "").startsWith("invalid_partner_id"));

    if (refusedHere && unknownThere) {
      out.push(
        `O partner_id está certo e é do ambiente ${base.environment}: lá a Shopee responde error_sign, que só acontece depois de encontrar o parceiro, e no host de ${otherEnvironment} ela responde invalid_partner_id. Não mexa em SHOPEE_ENV — o que não bate é a chave.`,
      );
    } else if (refusedHere) {
      out.push(
        `A Shopee reconhece este partner_id no ambiente ${base.environment} — error_sign só aparece depois de encontrar o parceiro — mas recusa a assinatura em todas as leituras da chave.`,
      );
    } else {
      out.push(
        `Assinatura recusada em ${attempts.length} tentativas, em ${base.environment} e ${otherEnvironment}. Isso descarta a codificação da chave e o ambiente trocado.`,
      );
    }

    if (clockSkewSeconds === null) {
      out.push("Não deu para medir o relógio (a Shopee não devolveu o cabeçalho Date). Confira se o horário do servidor está certo.");
    } else if (Math.abs(clockSkewSeconds) > 120) {
      out.push(
        `O relógio deste servidor está ${Math.round(clockSkewSeconds)}s fora do horário da Shopee. A assinatura inclui o timestamp e a Shopee recusa fora de ~5 minutos — esta é a causa.`,
      );
      return out;
    } else {
      out.push(`Relógio conferido: ${Math.round(clockSkewSeconds)}s de diferença para a Shopee. Descartado.`);
    }

    if (base.keyFormatOk) {
      out.push(`Formato da chave conferido: \`shpk\` + 60 hexadecimais, ${base.partnerKeyLength} caracteres. Descartado paste truncado.`);
    }

    out.push(
      "Sobram duas causas, as duas do lado do console da Shopee: (1) o partner_key configurado não é o que pertence a este partner_id — copiado da linha errada ou regerado no console depois da cópia; compare a impressão digital acima com o começo da chave na tela do console e copie de novo; (2) o app exige allowlist de IP e o IP de saída não está liberado. A Vercel não dá IP fixo no plano padrão.",
    );
    return out;
  }

  /**
   * Uma sondagem, com uma leitura da chave, contra um host. Devolve o
   * diagnóstico completo e, à parte, se a assinatura em si passou —
   * `error_sign` é o único erro que fala sobre a chave; qualquer outra
   * resposta significa que a Shopee validou a assinatura e reclamou de
   * outra coisa.
   */
  private async probeWithKey(
    candidate: ShopeeKeyCandidate,
    base: Omit<ShopeeDiagnosis, "ok" | "problems" | "shopeeError" | "shopCount" | "acceptedKeyEncoding" | "acceptedEnvironment" | "signAttempts" | "clockSkewSeconds">,
    host: string,
    environment: "test" | "live",
  ): Promise<{
    diagnosis: Omit<ShopeeDiagnosis, "acceptedKeyEncoding" | "acceptedEnvironment" | "signAttempts" | "clockSkewSeconds">;
    attempt: ShopeeSignAttempt;
    clockSkewSeconds: number | null;
    /** False only when the host never answered — rede, DNS, timeout. */
    reachedShopee: boolean;
  }> {
    const path = "/api/v2/public/get_shops_by_partner";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = shopeeSign(candidate.key, this.buildSignBase(path, timestamp));
    const url = `${host}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}&page_size=1`;

    const attemptBase = { encoding: candidate.encoding, environment, keyByteLength: candidate.byteLength };

    try {
      const res = await fetch(url, { method: "GET" });
      const raw = await res.text();

      // O cabeçalho Date é o relógio da própria Shopee. Comparar com o nosso
      // transforma "talvez seja o relógio" numa medição.
      const serverDate = res.headers?.get?.("date");
      const parsed = serverDate ? Date.parse(serverDate) : Number.NaN;
      const clockSkewSeconds = Number.isNaN(parsed) ? null : timestamp - Math.floor(parsed / 1000);

      let data: { error?: string; message?: string; response?: { authed_shop_list?: unknown[] } } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        return {
          diagnosis: {
            ...base,
            ok: false,
            problems: [`Shopee respondeu algo que não é JSON (HTTP ${res.status}).`],
            shopeeError: raw.slice(0, 300),
            shopCount: null,
          },
          // Resposta ilegível não diz nada sobre a assinatura; tratar como
          // recusa faz a sondagem seguir para as outras leituras, que é o
          // comportamento certo aqui.
          attempt: { ...attemptBase, signVerdict: "inconclusive", shopeeError: raw.slice(0, 120) },
          clockSkewSeconds,
          reachedShopee: true,
        };
      }

      if (data.error) {
        const shopeeError = `${data.error}${data.message ? ` — ${data.message}` : ""}`;
        return {
          diagnosis: {
            ...base,
            ok: false,
            problems: [explainShopeeError(data.error, base.environment)],
            shopeeError,
            shopCount: null,
          },
          attempt: { ...attemptBase, signVerdict: signVerdictFor(data.error), shopeeError },
          clockSkewSeconds,
          reachedShopee: true,
        };
      }

      return {
        diagnosis: {
          ...base,
          ok: true,
          problems: [],
          shopeeError: null,
          shopCount: data.response?.authed_shop_list?.length ?? 0,
        },
        attempt: { ...attemptBase, signVerdict: "accepted", shopeeError: null },
        clockSkewSeconds,
        reachedShopee: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "erro de rede";
      return {
        diagnosis: {
          ...base,
          ok: false,
          problems: [`Não foi possível alcançar ${host}: ${message}`],
          shopeeError: null,
          shopCount: null,
        },
        attempt: { ...attemptBase, signVerdict: "inconclusive", shopeeError: message },
        clockSkewSeconds: null,
        reachedShopee: false,
      };
    }
  }

  getAuthorizationUrl(state: string): string {
    const path = "/api/v2/shop/auth_partner";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp);
    const url = new URL(this.partnerHost + path);
    url.searchParams.set("partner_id", this.partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    url.searchParams.set("redirect", this.redirectUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, shopId?: string): Promise<OAuthTokenResult> {
    const path = "/api/v2/auth/token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp);
    const res = await fetch(`${this.partnerHost}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, partner_id: Number(this.partnerId), shop_id: shopId ? Number(shopId) : undefined }),
    });
    if (!res.ok) {
      throw new MarketplaceApiError(`Falha ao obter token da Shopee (HTTP ${res.status})`, "SHOPEE", res.status);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expire_in: number;
      shop_id: number;
      error?: string;
      message?: string;
    };
    if (data.error) {
      throw new MarketplaceApiError(`Shopee: ${data.error} — ${data.message}`, "SHOPEE");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + data.expire_in * 1000),
      externalShopId: String(data.shop_id),
    };
  }

  async refreshAccessToken(refreshToken: string, shopId?: string): Promise<OAuthTokenResult> {
    const path = "/api/v2/auth/access_token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp);
    const res = await fetch(`${this.partnerHost}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        partner_id: Number(this.partnerId),
        shop_id: shopId ? Number(shopId) : undefined,
      }),
    });
    if (!res.ok) {
      throw new MarketplaceApiError(
        `Falha ao renovar token da Shopee (HTTP ${res.status})`,
        "SHOPEE",
        res.status,
      );
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expire_in: number;
      shop_id: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + data.expire_in * 1000),
      externalShopId: String(data.shop_id),
    };
  }

  /**
   * Uma chamada assinada de nível loja. Todas passam por aqui para que a
   * assinatura, o tratamento de erro da Shopee e o formato do erro fiquem
   * num lugar só — a Shopee devolve HTTP 200 com `error` no corpo, então
   * checar `res.ok` sozinho deixa a falha passar silenciosamente.
   */
  private async shopRequest<T>(
    path: string,
    credentials: ProviderCredentials,
    query: Record<string, string> = {},
  ): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp, credentials.accessToken, credentials.externalShopId);

    const url = new URL(this.partnerHost + path);
    url.searchParams.set("partner_id", this.partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    url.searchParams.set("shop_id", credentials.externalShopId);
    url.searchParams.set("access_token", credentials.accessToken);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const res = await fetch(url.toString());
    const text = await res.text();

    let body: { error?: string; message?: string; response?: T };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new MarketplaceApiError(
        `Shopee respondeu algo que não é JSON em ${path} (HTTP ${res.status}).`,
        "SHOPEE",
        res.status,
      );
    }

    if (body.error) {
      throw new MarketplaceApiError(
        `Shopee ${path}: ${body.error}${body.message ? ` — ${body.message}` : ""}`,
        "SHOPEE",
        res.status,
        body.error,
      );
    }
    if (!res.ok) {
      throw new MarketplaceApiError(`Shopee ${path} falhou (HTTP ${res.status}).`, "SHOPEE", res.status);
    }

    return body.response as T;
  }

  async fetchProducts(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
  ): Promise<FetchPage<NormalizedProduct>> {
    const offset = cursor.value ? Number(cursor.value) : 0;

    const list = await this.shopRequest<{
      item: { item_id: number }[];
      has_next_page: boolean;
      next_offset: number;
    }>("/api/v2/product/get_item_list", credentials, {
      offset: String(offset),
      page_size: "50",
      item_status: "NORMAL",
    });

    const itemIds = (list.item ?? []).map((i) => i.item_id);
    if (itemIds.length === 0) {
      return { items: [], nextCursor: { value: String(list.next_offset ?? 0) }, hasMore: Boolean(list.has_next_page) };
    }

    // get_item_list só devolve IDs. Sem esta segunda chamada o produto entra
    // com o item_id no lugar do SKU, e aí nenhum custo cadastrado casa.
    const base = await this.shopRequest<{
      item_list: {
        item_id: number;
        item_name?: string;
        item_sku?: string;
        has_model?: boolean;
        image?: { image_url_list?: string[] };
      }[];
    }>("/api/v2/product/get_item_base_info", credentials, {
      item_id_list: itemIds.join(","),
    });

    const items: NormalizedProduct[] = [];

    for (const item of base.item_list ?? []) {
      const imageUrl = item.image?.image_url_list?.[0];
      const title = item.item_name ?? `Shopee item ${item.item_id}`;

      if (!item.has_model) {
        items.push({
          externalProductId: String(item.item_id),
          sku: item.item_sku?.trim() || String(item.item_id),
          title,
          imageUrl,
          raw: item,
        });
        continue;
      }

      // Quem vende variação cadastra custo por variação, e os pedidos vêm com
      // `model_sku`. Um produto por anúncio, aqui, deixaria todo pedido de
      // variação sem custo.
      try {
        const models = await this.shopRequest<{
          model: { model_id: number; model_name?: string; model_sku?: string }[];
        }>("/api/v2/product/get_model_list", credentials, { item_id: String(item.item_id) });

        for (const model of models.model ?? []) {
          items.push({
            externalProductId: String(item.item_id),
            externalVariationId: String(model.model_id),
            sku: model.model_sku?.trim() || item.item_sku?.trim() || String(model.model_id),
            title: model.model_name ? `${title} — ${model.model_name}` : title,
            imageUrl,
            raw: { item, model },
          });
        }
      } catch {
        // Perder as variações de um anúncio não justifica derrubar a página
        // inteira; o anúncio entra sem variação e o log do sync registra.
        items.push({
          externalProductId: String(item.item_id),
          sku: item.item_sku?.trim() || String(item.item_id),
          title,
          imageUrl,
          raw: item,
        });
      }
    }

    return {
      items,
      nextCursor: { value: String(list.next_offset ?? 0) },
      hasMore: Boolean(list.has_next_page),
    };
  }

  /** Janela máxima documentada de consulta de pedidos: 15 dias por chamada. */
  private static readonly ORDER_WINDOW_SECONDS = 15 * 24 * 3600;

  async fetchOrders(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
    updatedAfter?: Date,
  ): Promise<FetchPage<NormalizedOrder>> {
    const now = Math.floor(Date.now() / 1000);

    // O cursor carrega a janela junto com o cursor da Shopee. Sem isso, uma
    // conta parada por dois meses só recuperaria os últimos 15 dias e os
    // pedidos do meio sumiriam sem ninguém notar.
    const [windowRaw, innerCursor = ""] = (cursor.value ?? "").split("|");
    const defaultFrom = updatedAfter
      ? Math.floor(updatedAfter.getTime() / 1000)
      : now - ShopeeProvider.ORDER_WINDOW_SECONDS;
    const from = windowRaw ? Number(windowRaw) : defaultFrom;
    const to = Math.min(from + ShopeeProvider.ORDER_WINDOW_SECONDS, now);

    const list = await this.shopRequest<{
      order_list?: { order_sn: string }[];
      more?: boolean;
      next_cursor?: string;
    }>("/api/v2/order/get_order_list", credentials, {
      time_range_field: "update_time",
      time_from: String(from),
      time_to: String(to),
      page_size: "50",
      ...(innerCursor ? { cursor: innerCursor } : {}),
    });

    const advance = (): { nextCursor: SyncCursor; hasMore: boolean } => {
      if (list.more && list.next_cursor) {
        return { nextCursor: { value: `${from}|${list.next_cursor}` }, hasMore: true };
      }
      // Janela esgotada: anda para a próxima até alcançar o presente.
      if (to < now) return { nextCursor: { value: `${to}|` }, hasMore: true };
      return { nextCursor: { value: null }, hasMore: false };
    };

    const orderSns = (list.order_list ?? []).map((o) => o.order_sn);
    if (orderSns.length === 0) {
      return { items: [], ...advance() };
    }

    const detail = await this.shopRequest<{ order_list?: ShopeeOrderDetailRaw[] }>(
      "/api/v2/order/get_order_detail",
      credentials,
      {
        order_sn_list: orderSns.join(","),
        response_optional_fields: "item_list,total_amount,actual_shipping_fee,estimated_shipping_fee",
      },
    );

    const items: NormalizedOrder[] = [];
    for (const order of detail.order_list ?? []) {
      items.push(normalizeShopeeOrder(order, await this.fetchEscrow(credentials, order.order_sn)));
    }

    return { items, ...advance() };
  }

  /**
   * As taxas que a Shopee cobra do vendedor só existem aqui, e é uma chamada
   * por pedido — não há endpoint em lote.
   *
   * Devolve null em vez de estourar de propósito: um pedido que ainda não teve
   * o repasse liberado, ou uma conta sem a API de pagamentos liberada, não
   * podem derrubar a sincronização inteira. O pedido entra marcado como sem
   * taxa confirmada, que é a verdade sobre ele.
   */
  private async fetchEscrow(
    credentials: ProviderCredentials,
    orderSn: string,
  ): Promise<ShopeeEscrowRaw | null> {
    try {
      return await this.shopRequest<ShopeeEscrowRaw>("/api/v2/payment/get_escrow_detail", credentials, {
        order_sn: orderSn,
      });
    } catch {
      return null;
    }
  }

  async fetchAdCampaigns(): Promise<never> {
    throw new MarketplaceNotImplementedError("SHOPEE", "fetchAdCampaigns (Shopee Ads API)");
  }

  async fetchAdSpend(): Promise<never> {
    throw new MarketplaceNotImplementedError("SHOPEE", "fetchAdSpend (Shopee Ads API)");
  }
}
