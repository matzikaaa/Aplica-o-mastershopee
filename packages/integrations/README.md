# @mastershopee/integrations

Marketplace adapter layer (§2, §3, §86). Nothing outside this package talks
to a marketplace API directly — everything else depends on the
`MarketplaceProvider` interface (`src/provider.ts`) and the normalized
types in `src/types.ts`, so adding a new marketplace never touches
dashboard, financial-engine, or worker code.

```
External Order → MarketplaceProvider adapter → NormalizedOrder → FinancialCalculationEngine → Metrics
```

## Status per marketplace

| Marketplace     | OAuth | Products | Orders | Ads | Webhooks | Blocking on |
|------------------|:---:|:---:|:---:|:---:|:---:|---|
| Mercado Livre    | ✅ | ✅ | ✅ | ❌ | ✅ (resource-fetch model) | `MERCADOLIVRE_APP_ID` / `MERCADOLIVRE_CLIENT_SECRET` |
| Shopee           | ✅ | ✅ | ⚠️ order-list only (detail hydration pending) | ❌ | ✅ | `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` + live contract verification |
| TikTok Shop      | ⚠️ scaffold | ❌ | ❌ | ❌ | ⚠️ scaffold | `TIKTOKSHOP_APP_KEY` / `TIKTOKSHOP_APP_SECRET` + current API version confirmation |
| SHEIN            | ❌ | ❌ | ❌ | ❌ | ❌ | No public self-serve developer API found. Requires direct SHEIN partner approval and documentation. |

None of these are simulated — see `MarketplaceNotImplementedError` thrown
by every unimplemented method, which is surfaced to the Integrations page
(§33) as an honest "não disponível" state rather than fake data.

## Mercado Livre

- Docs: https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br
- OAuth: authorization-code flow via `auth.mercadolivre.com.br/authorization`,
  token exchange at `api.mercadolibre.com/oauth/token`.
- Orders: `GET /orders/search?seller={id}` — incremental sync uses
  `order.date_last_updated.from` (§36).
- **Ads (ROAS/ACOS) require the separate Mercado Ads API**, which needs
  additional partner approval beyond a standard app. Until granted,
  `fetchAdCampaigns`/`fetchAdSpend` throw rather than return invented numbers.
- Webhooks: ML does not HMAC-sign payloads. It POSTs `{ topic, resource,
  user_id }` and the receiver re-fetches `resource` with its own access
  token — that successful authenticated fetch *is* the signature check.

## Shopee (Open Platform v2)

- Docs: https://open.shopee.com/documents
- Requires Shopee Open Platform partner registration and app approval
  before `SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY` exist.
- Request signing: `HMAC-SHA256(partner_key, partner_id + path + timestamp
  [+ access_token + shop_id])`, per Shopee's documented scheme.
- `fetchOrders` currently hydrates only order IDs from `get_order_list`;
  the batch call to `get_order_detail` for amounts/items/fees is not
  implemented because its exact response shape could not be verified
  without a live partner key — implementing it against guessed field names
  would risk silently wrong financial numbers, which this project treats
  as worse than an explicit "not implemented" error.

## TikTok Shop Partner Center

- Docs: https://partner.tiktokshop.com/docv2
- TikTok Shop versions its API paths aggressively (e.g. `/202309/`,
  `/202312/`) and availability differs by region. The OAuth handshake
  pattern and HMAC signing shape are implemented; data endpoints are
  intentionally left unimplemented pending confirmation of the current
  version for the target region and `TIKTOKSHOP_APP_KEY`/`_SECRET`.

## SHEIN

No public, self-serve developer portal with documented endpoints was
available at implementation time. SHEIN grants marketplace/seller API
access case-by-case to approved partners. `SheinProvider` exists only so
the platform can show an honest "not connected — pending SHEIN partner
approval" state; every method throws until real docs and credentials
exist, at which point only this one file needs to change.

## Adding a new marketplace (Amazon, Magalu, Shopify, Nuvemshop, Tray, VTEX, AliExpress...)

1. Implement `MarketplaceProvider` in a new `src/providers/<name>.ts`.
2. Add the enum value to `MarketplaceType` (`packages/shared/src/types.ts`)
   and to the Prisma `MarketplaceType` enum (`packages/database`), then
   create a migration.
3. Register it in `src/registry.ts`.
4. No changes needed anywhere else — the financial engine, dashboard and
   worker only ever see `NormalizedOrder`/`NormalizedProduct`.

## Security

- `credentials.ts` encrypts access/refresh tokens with AES-256-GCM before
  they ever reach the database (`CREDENTIALS_ENCRYPTION_KEY`, §39).
- `redactSecret()` must be used any time a token could end up in a log
  line or error message.
- `rate-limiter.ts` provides both an in-memory bucket (tests/dev) and a
  Redis-backed distributed bucket (`RedisTokenBucket`) so multiple worker
  processes share one marketplace's rate limit (§34).
