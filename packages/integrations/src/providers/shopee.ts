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
export interface ShopeeSignAttempt {
  encoding: ShopeeKeyEncoding;
  /** Which host this reading was tried against. */
  environment: "test" | "live";
  /** Byte length of the derived key — never the key itself. */
  keyByteLength: number;
  /** True when Shopee did *not* answer `error_sign`. */
  signAccepted: boolean;
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

        if (!result.attempt.signAccepted) {
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
    const environments = [...new Set(attempts.map((a) => a.environment))];
    const out = [
      `Assinatura recusada em ${attempts.length} tentativas — todas as leituras da chave, nos ambientes ${environments.join(" e ")}. Isso descarta a codificação da chave e o ambiente trocado.`,
    ];

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
      "Sobram duas causas, e as duas se resolvem no console da Shopee: (1) o partner_key não é o deste partner_id — as linhas de Test e de Live são parecidas e a chave pode ter sido regerada desde que você copiou; confira o começo da chave contra a impressão digital acima e copie de novo; (2) o app exige allowlist de IP e o IP de saída não está liberado. A Vercel não dá IP fixo no plano padrão.",
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
          attempt: { ...attemptBase, signAccepted: false, shopeeError: raw.slice(0, 120) },
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
          attempt: { ...attemptBase, signAccepted: data.error !== "error_sign", shopeeError },
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
        attempt: { ...attemptBase, signAccepted: true, shopeeError: null },
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
        attempt: { ...attemptBase, signAccepted: false, shopeeError: message },
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

  async fetchProducts(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
  ): Promise<FetchPage<NormalizedProduct>> {
    const path = "/api/v2/product/get_item_list";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp, credentials.accessToken, credentials.externalShopId);
    const offset = cursor.value ? Number(cursor.value) : 0;

    const url = new URL(this.partnerHost + path);
    url.searchParams.set("partner_id", this.partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    url.searchParams.set("shop_id", credentials.externalShopId);
    url.searchParams.set("access_token", credentials.accessToken);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("page_size", "50");
    url.searchParams.set("item_status", "NORMAL");

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new MarketplaceApiError(
        `Chamada à API de produtos da Shopee falhou (HTTP ${res.status})`,
        "SHOPEE",
        res.status,
      );
    }
    const data = (await res.json()) as {
      response: { item: { item_id: number; item_status: string }[]; has_next_page: boolean; next_offset: number };
    };

    // Item list only returns IDs — item basic info (title/sku/image) needs a
    // follow-up call to /api/v2/product/get_item_base_info, omitted here for
    // brevity but required for a complete implementation.
    const items: NormalizedProduct[] = data.response.item.map((i) => ({
      externalProductId: String(i.item_id),
      sku: String(i.item_id),
      title: `Shopee item ${i.item_id}`,
      raw: i,
    }));

    return {
      items,
      nextCursor: { value: String(data.response.next_offset) },
      hasMore: data.response.has_next_page,
    };
  }

  async fetchOrders(
    credentials: ProviderCredentials,
    cursor: SyncCursor,
    updatedAfter?: Date,
  ): Promise<FetchPage<NormalizedOrder>> {
    const path = "/api/v2/order/get_order_list";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp, credentials.accessToken, credentials.externalShopId);

    // Shopee's order list is time-window based (max 15 days per call) rather
    // than offset-based like Mercado Livre — cursor stores the last window's
    // `next_cursor` token issued by Shopee itself.
    const url = new URL(this.partnerHost + path);
    url.searchParams.set("partner_id", this.partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    url.searchParams.set("shop_id", credentials.externalShopId);
    url.searchParams.set("access_token", credentials.accessToken);
    url.searchParams.set("time_range_field", "update_time");
    const from = updatedAfter ?? new Date(Date.now() - 15 * 24 * 3600 * 1000);
    url.searchParams.set("time_from", String(Math.floor(from.getTime() / 1000)));
    url.searchParams.set("time_to", String(Math.floor(Date.now() / 1000)));
    url.searchParams.set("page_size", "50");
    if (cursor.value) url.searchParams.set("cursor", cursor.value);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new MarketplaceApiError(
        `Chamada à API de pedidos da Shopee falhou (HTTP ${res.status})`,
        "SHOPEE",
        res.status,
      );
    }
    const data = (await res.json()) as {
      response: { order_list: { order_sn: string }[]; more: boolean; next_cursor: string };
    };

    // NOTE: get_order_list only returns order_sn identifiers. A complete
    // implementation calls /api/v2/order/get_order_detail in batches to
    // fetch amounts/items/fees before normalizing — omitted here since it
    // cannot be exercised without a live partner_id/partner_key.
    throw new MarketplaceNotImplementedError(
      "SHOPEE",
      `fetchOrders detail hydration (found ${data.response.order_list.length} order IDs; ` +
        "get_order_detail call pending real credentials to validate response shape)",
    );
  }

  async fetchAdCampaigns(): Promise<never> {
    throw new MarketplaceNotImplementedError("SHOPEE", "fetchAdCampaigns (Shopee Ads API)");
  }

  async fetchAdSpend(): Promise<never> {
    throw new MarketplaceNotImplementedError("SHOPEE", "fetchAdSpend (Shopee Ads API)");
  }
}
