# Mastershopee

Central financeira inteligente para vendedores de marketplaces. Conecta Shopee, Mercado Livre, SHEIN e TikTok Shop e calcula automaticamente faturamento, taxas, anúncios e **lucro líquido real** — por pedido, por produto e por marketplace.

This README documents what is implemented, how to run it, and — critically — **what still depends on external credentials that only a human can obtain** (marketplace partner approval, WhatsApp Business verification, Stripe keys). Nothing in this codebase fakes those integrations; see the status tables below and `packages/integrations/README.md`.

## Architecture

Monorepo (pnpm workspaces), chosen over multiple repos because the financial-calculation logic, billing rules, and normalized data model must be shared byte-for-byte between the web app and the background worker — duplicating them across repos is exactly the "cálculos financeiros diferentes em componentes diferentes" anti-pattern the project brief calls out (§60).

```
apps/
  web/            Next.js 14 (App Router, TS, Tailwind) — landing page, auth, dashboard, admin, API routes
  worker/         BullMQ background worker — marketplace sync, metric aggregation, WhatsApp scheduler, alerts
packages/
  database/       Prisma schema + client + seed (single source of truth for the data model)
  shared/         Money/Decimal type, date-range helpers, zod schemas, shared types
  financial-engine/  FinancialCalculationEngine — the ONLY place profit/margin math happens (tested)
  billing/        Plan catalog + PlanPermissionService — the ONLY place plan/feature checks happen (tested)
  integrations/   MarketplaceProvider interface + Shopee/Mercado Livre/SHEIN/TikTok Shop adapters
  inventory/      Reorder maths — the ONLY place "is this product running out?" is decided (tested)
```

**Why this split:** `financial-engine` and `billing` have zero framework dependencies (no Next.js, no Prisma types even) so they're trivially unit-testable and reusable from both `apps/web` (dashboard, reports) and `apps/worker` (nightly aggregation, WhatsApp summaries) without risking the two ever computing a different number for the same order.

### Request flow for a dashboard page

```
Server Component (apps/web)
  → requireWorkspace() [multi-tenant boundary, §8]
  → getPlanPermissionService() [plan/feature gate, §28]
  → Prisma query scoped to workspaceId
  → FinancialCalculationEngine.calculateOrder/aggregate [§60]
  → render
```

### Sync flow

```
OAuth callback → encrypt tokens (AES-256-GCM) → MarketplaceCredential
Webhook received → verify + store WebhookEvent → enqueue webhook-processing job → 200 fast (§35)
Queued job → MarketplaceProvider.fetchOrders/fetchProducts → normalize → upsert (idempotent, §87)
                                                            → resolve cost snapshot at order date (§16)
Worker (every 15 min) → computeDailyMetrics → DailyMetric/ProductMetric/MarketplaceMetric (§54)
Worker (every minute) → whatsapp-scheduler → send if workspace's configured local time matches (§64)
```

## Getting started

### Prerequisites

- Node.js 20+, pnpm 9+
- PostgreSQL 16 and Redis 7 (via Docker, or installed locally)

### Setup

```bash
pnpm install
cp .env.example .env          # fill in what you have; see "Pending credentials" below
docker compose up -d          # postgres + redis (or run them natively)

pnpm db:migrate                # applies packages/database/prisma/migrations
pnpm db:seed                   # plan catalog ONLY — no sample data

pnpm dev                       # apps/web on http://localhost:3000
pnpm dev:worker                # apps/worker (separate terminal)
```

Register at `/register` and the dashboard stays genuinely empty until a real marketplace account is connected — no invented orders, revenue or metrics anywhere (§75, §94).

With no SMTP configured, the verification e-mail is printed to the dev server's
console (look for `[email:dev-fallback]`) instead of being silently swallowed.
To skip the round trip locally:

```bash
pnpm db:verify-user voce@exemplo.com   # refuses to run with NODE_ENV=production
```

### Demo data (opt-in)

```bash
pnpm db:seed:demo    # synthetic user/workspace/orders — login: demo@mastershopee.app / demo12345
pnpm db:purge:demo   # removes all of it, leaves the plan catalog intact

# That password is published here, which makes it a local-only credential. On
# any deployed instance — including the login handed to a marketplace reviewer
# — change it first, or the account is open to anyone who reads this file:
pnpm db:set-password demo@mastershopee.app 'senha-forte-unica'
```

Kept deliberately separate from `pnpm db:seed` so no install ever shows fabricated numbers by default. Everything it writes is `[DEMO]`-labelled, and it refuses to run under `NODE_ENV=production` (override with `ALLOW_DEMO_SEED=true` only for a throwaway environment) — note it marks marketplace accounts `CONNECTED` without any real OAuth connection, which must never reach a production database.

### Tests

```bash
pnpm test          # runs every package's vitest suite (financial-engine, billing, integrations)
pnpm --filter @mastershopee/worker test:integration   # worker jobs against a real Postgres/Redis — see below
```

`financial-engine` and `billing` are the two packages explicitly required to have tests (§59-60): historical cost resolution, margin/ROAS math, Decimal precision, plan-limit enforcement, and subscription-state access rules are all covered. 97 unit tests across `financial-engine`, `billing`, `shared`, `integrations`, `inventory` and `apps/worker`, plus 19 integration tests against a real Postgres/Redis, as of this writing.

**Worker integration tests** (`apps/worker/src/jobs/__tests__/integration/*.integration.test.ts`, run via `test:integration`, config in `apps/worker/vitest.integration.config.ts`): these run the DB-touching jobs — `compute-daily-metrics`, `process-webhook`, `check-alerts`, `sync-marketplace`, and the stock ledger — against a real local Postgres and Redis (BullMQ) instead of mocks, because the thing actually worth verifying is behavior a mock can't meaningfully exercise: Decimal precision surviving a real round-trip through Postgres, idempotent upserts, alert dedupe, and the `IntegrationSync.lockKey` unique-constraint lock. They're kept out of the default `pnpm test` (which CI/dev environments without that infra can still run) and use a disposable per-test workspace that cascades away in an `afterEach`, so they don't touch seed/demo data. Writing this harness caught a real bug: `lockKey` was set once at sync start and never cleared, so a marketplace account could only ever sync once per sync type for its entire lifetime — every later sync silently no-op'd. Fixed in `sync-marketplace.ts` by clearing the lock on every terminal state, not just success.

### Build / typecheck

```bash
pnpm build         # builds every package + apps/web (turbo-free; plain pnpm -r)
pnpm typecheck      # tsc --noEmit across the whole monorepo
```

`apps/web` has been verified with a full `next build` and a real `next start` against a live Postgres instance (login, dashboard, products, costs, orders, order-detail with profit breakdown, ads, financial DRE, reports export, alerts, integrations, settings, subscription, and the super-admin panel all return 200 and render real seeded numbers).

## What's implemented vs. pending

### Implemented (real, working, tested where noted)

- **Foundation**: monorepo, Prisma schema covering the full entity list (§37), Docker Compose, `.env.example`, strict TypeScript across every package.
- **Auth**: registration, e-mail verification (token-hash + expiry), login (NextAuth v4 Credentials + JWT), password reset, scrypt password hashing (no plaintext, ever), route protection via middleware (dashboard/admin/onboarding).
- **Multi-tenancy**: `Workspace` → `WorkspaceMember` → all data scoped by `workspaceId`; every server entry point re-resolves the workspace from the authenticated session, never from a client-supplied id (§8, §38).
- **Financial engine** (tested): `FinancialCalculationEngine.calculateOrder/aggregate`, `percentChange`, `explain()` (line-by-line breakdown for the "Como calculamos?" drawer, §21/§83), price-suggestion and price-simulation calculators (§67-68), ROAS/ACOS math, the "Saúde da operação" composite score (§49, methodology always disclosed).
- **Billing** (tested): `PLAN_CATALOG` (Starter/Pro/Scale with real limits/features), `PlanPermissionService` (`canConnectMarketplace`, `canUseWhatsApp`, `canUseAds`, `canUseAdvancedReports`, `canAddTeamMember`, `canProcessMoreOrders`, `getMarketplaceLimit`) — the single place plan checks happen, subscription state machine (`trialing/active/past_due/canceled/expired/incomplete`) with backend-enforced access rules.
- **Marketplace integrations**: `MarketplaceProvider` interface, credential encryption (AES-256-GCM), rate limiting (in-memory + Redis token buckets), OAuth connect/callback/disconnect routes wired to real plan-limit checks. **Mercado Livre** adapter is functionally complete against documented endpoints (OAuth, incremental order sync, product listing). **Shopee** adapter implements the full HMAC-signed request shape and OAuth flow; order-detail hydration is left as an explicit `MarketplaceNotImplementedError` pending live credentials to verify the response contract. **TikTok Shop** and **SHEIN** are structured but intentionally not wired to invented endpoints — see `packages/integrations/README.md` for exactly why and what's needed.
- **Dashboard**: KPI cards with period-over-period deltas, revenue/profit/expense/ADS chart, financial composition waterfall (§13), marketplace participation, product profit ranking, loss-making-product callouts with data pulled from real orders (not mocked), operation-health score, incomplete-cost-data banner (§96).
- **Products / Costs**: profit-per-SKU table with 🟢/🟡/🔴 status, cost CRUD with **preserved history** (old orders always use the cost effective on their sale date — verified: seeding a new cost never rewrites past `OrderItem.unitCostSnapshot`), CSV bulk import with per-row validation and an import/update/skip/error report, downloadable template.
- **Orders**: paginated list with computed profit, order-detail page showing the full line-by-line breakdown.
- **Ads**: gated by plan; honestly reports "not available yet" per marketplace instead of inventing ROAS/ACOS numbers no API has returned (§18).
- **Financial**: simplified DRE (§27) computed from the same aggregation the dashboard uses.
- **Reports**: working CSV/XLSX export for orders (XLSX gated to Pro, matching `canUseAdvancedReports`); other report types are visibly marked "em breve" rather than offering broken buttons.
- **Price calculator** (§67-68): solves either direction — a target margin into a sale price, or a sale price into the margin it leaves — with packaging costed separately (bulk price ÷ units per pack, since packaging is bought by the roll and used by the shipment). Marketplace deductions are seeded from what each marketplace *actually charged this workspace*, measured from its own synced orders, and stay editable; there is deliberately no built-in commission table, because published rates vary by category and change without notice, and shipping one as authoritative would put an invented number under every pricing decision (§96). With no sales history the fields start empty and say why.

  Shopee additionally gets an optional **banded schedule** (`fee-schedule.ts`), because it charges a percentage *plus a fixed amount per item* and both change with the price band. That makes solving for a target margin piecewise — the band sets the fee, but the price sets the band — so each band is solved independently and an answer is kept only if it lands inside the band it assumed. Two consequences the UI surfaces: a margin can be reachable at two different prices, and pricing just above a boundary can earn less than pricing just below it (at R$30 cost, R$79.99 nets R$23.19 while R$80.00 nets R$16.00). The table is labelled with its source and marked unverified — it was corroborated across public sources but Shopee's own seller page is unreachable from this environment — and stays editable.
- **Stock**: balance per product, debited automatically by marketplace syncs (idempotent per order item, so re-syncing never double-deducts) and credited back on cancellations/returns. The operator's only manual step is registering arriving goods. Reorder alerts fire while there is still time to order: `@mastershopee/inventory` compares days of cover against the supplier's lead time plus a configurable safety margin, and the warning goes to the in-app notification centre plus WhatsApp when a verified number exists. A product with no sales in the window gets no projection at all rather than an invented one (§96). Each product has a movement history page showing every entry, sale, cancellation and the running balance after it, so the number on the list can always be explained line by line (§21).
- **Spreadsheet import**: bulk-loads products/costs/stock, historical orders and ad spend from the marketplace's own exports, which is what makes the app usable with a real catalogue before any API integration is approved. Columns are mapped by the operator (guessed, never assumed) because every marketplace names them differently, and values are parsed in Brazilian format — `1.234,56`, `31/12/2026`. Unreadable cells become a reported row error rather than a silent zero. Re-importing is safe: orders key on the order number, ad spend on campaign+day, and stock is set to the declared balance rather than added to it. Imported rows hang off a clearly-labelled `NOT_CONNECTED` account so nothing hand-loaded ever looks synced.
- **Alerts**: rule creation (5 configurable trigger types), severity-grouped event feed, worker job that evaluates rules against real `DailyMetric`/`ProductMetric` rows.
- **Integrations page**: live connection status per marketplace, plan-limit-aware "Conectar" button, disconnect flow, honest "configuração pendente" state when a marketplace has no partner credentials in this environment.
- **Settings**: profile, company (name/timezone — drives every daily aggregation, §63), team list, WhatsApp destination/schedule, password change.
- **Subscription**: plan/usage display, plan-change and cancel actions (operate directly on the `Subscription` row in dev mode when `STRIPE_SECRET_KEY` is absent — clearly commented, never presented as a real charge).
- **Admin panel**: MRR/ARR, trial/past-due/churn counts, integration/webhook error counts, customers missing cost data — gated by `isSuperAdmin` at both the middleware and the layout (defense in depth, §51).
- **Worker**: BullMQ queues for marketplace sync (idempotent via unique `lockKey`, rate-limited, incremental via `updatedAfter` cursors), daily metric aggregation, WhatsApp daily-report scheduler (per-workspace timezone-aware), alert evaluation, webhook processing (fast-ack pattern, §35).
- **Security**: AES-256-GCM credential encryption, scrypt password hashing, HMAC-signed/expiring OAuth `state`, audit log on sensitive actions (cost changes, marketplace connect/disconnect, password reset, plan changes), secrets never logged (`redactSecret`), ownership checks on every mutation.

### Explicitly PENDING — needs a human to obtain something

| What | Blocks | Where the code is ready and waiting |
|---|---|---|
| `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` | Real Shopee sync (adapter implemented, needs partner approval at open.shopee.com) | `packages/integrations/src/providers/shopee.ts` |
| `MERCADOLIVRE_APP_ID` / `MERCADOLIVRE_CLIENT_SECRET` | Real Mercado Livre sync (adapter fully implemented) | `packages/integrations/src/providers/mercado-livre.ts` |
| SHEIN partner API access + documentation | Any SHEIN integration at all — no public self-serve API exists today | `packages/integrations/src/providers/shein.ts` |
| `TIKTOKSHOP_APP_KEY` / `TIKTOKSHOP_APP_SECRET` + confirmed current API version | Real TikTok Shop sync | `packages/integrations/src/providers/tiktok-shop.ts` |
| Shopee/Mercado Livre/TikTok Shop **Ads API** approval (separate from the base commerce API) | Any ROAS/ACOS numbers on the Ads page | `fetchAdCampaigns`/`fetchAdSpend` on every provider — currently throw rather than fabricate |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (Meta Business verification + approved template) | Daily WhatsApp summary actually being delivered | `apps/worker/src/jobs/whatsapp-scheduler.ts` — records a `WhatsappReport` with a clear "not configured" error today |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` + Stripe products/prices | Real recurring billing (checkout, invoices, dunning) | `apps/web/src/app/api/webhooks/stripe/route.ts` (scaffolded, returns 501 until configured) and `.../subscription/change-plan/route.ts` (dev-mode fallback clearly commented) |
| SMTP credentials (`EMAIL_SERVER_*`) | Verification/reset e-mails actually being delivered (currently logged to the server console) | `apps/web/src/lib/email.ts` |

No integration was faked to look finished. Where a credential is missing, the code path either throws a typed `MarketplaceNotImplementedError`/`501`, or — for flows that must still be testable locally (subscription changes, WhatsApp config) — clearly comments that it's a development fallback.

## Database

PostgreSQL via Prisma. Money is **always** `Decimal(14,4)` (never `float`/`number` in the schema or in `financial-engine`) — see `packages/shared/src/money.ts`. Every write path that touches subscription/cost/marketplace state also writes an `AuditLog` row.

```bash
pnpm db:migrate     # create/apply a migration from schema changes
pnpm db:studio      # Prisma Studio GUI
pnpm db:seed        # plan catalog only (production-safe) — prisma/seed.ts
pnpm db:seed:demo   # opt-in synthetic data — prisma/seed-demo.ts
pnpm db:purge:demo  # remove synthetic data — prisma/purge-demo.ts
```

## Environment variables

See `.env.example` for the full list with inline documentation of what each one unlocks. Never commit real secrets — `.env` is gitignored.

## Deployment notes

**Passo a passo completo (Vercel + Neon + Upstash, tudo em plano gratuito): [`DEPLOYMENT.md`](./DEPLOYMENT.md)** — inclui as variáveis exatas, migrations em produção e o que configurar no console da Shopee.

- `apps/web` is a standard Next.js app — deployable to any Node host or a platform with Next.js support. Requires `DATABASE_URL`, `AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` at minimum to boot into a usable (if integration-less) state.
- `apps/worker` is a long-running Node process (`pnpm --filter @mastershopee/worker start`) — needs `REDIS_URL` and the same `DATABASE_URL`. Run it as a separate service/container from the web app; it is not request-driven.
- Run `pnpm db:migrate:deploy` (via `prisma migrate deploy`) as part of your deploy pipeline, never `migrate dev` in production.
- Back up Postgres on a schedule appropriate to your provider (e.g. daily snapshot + point-in-time recovery); this repo does not include a backup script since that's infrastructure-specific, not application code.

## Security posture

- Passwords: scrypt with per-user random salt, timing-safe comparison (`apps/web/src/lib/password.ts`).
- Marketplace tokens: AES-256-GCM, key from `CREDENTIALS_ENCRYPTION_KEY`, never logged (`redactSecret`).
- OAuth CSRF: signed, expiring `state` parameter (`apps/web/src/lib/oauth-state.ts`) — no server-side session needed for the round trip.
- Multi-tenant isolation: every query in `apps/web` goes through `requireWorkspace()`, which re-derives the workspace from the authenticated session server-side.
- Ownership checks: mutations (e.g. adding a cost) verify the target row belongs to the caller's workspace before writing.
- Rate limiting / idempotency: see `packages/integrations/src/rate-limiter.ts` and the unique constraints backing `Order`, `WebhookEvent`, and `IntegrationSync.lockKey`.

## Privacy (LGPD) — flagged for legal review

This codebase includes the technical building blocks LGPD compliance needs (per-workspace data isolation, audit logging, password/token hashing) but **does not** include a Política de Privacidade, Termos de Uso, or a self-service data-export/account-deletion flow — those are product/legal decisions, not something to auto-generate. Flagging explicitly per the project brief's instruction not to present unreviewed legal content as final (§79).

## Roadmap (not yet started)

Wiring a real Sentry SDK behind `lib/observability.ts` (the seam and structured JSON logging are in place, `@sentry/nextjs` itself is not installed since no DSN is available in this environment). Everything else FASE 6-10 originally called out here — insights (§66), CSP, and a Postgres/Redis integration-test harness for the worker jobs — is now implemented; see the sections above.

Already closed since the initial foundation commit: security headers + brute-force rate limiting on auth endpoints (§38), a strict Content-Security-Policy (§38), branded error/404 boundaries instead of Next's defaults (§44), the onboarding "first sync progress" UI (§82 — `SyncProgress` polls real `IntegrationSync` rows, no invented stage labels), "Sincronizar agora"/"Reconectar" actions on the Integrations page (§33), rule-based Insights (§66), a real notification center (§50), and the `?plan=` pricing param carrying through to onboarding.
