-- STOCK_LOW was added with the stock module but never used: low-stock
-- warnings run from their own worker job and are configured per product
-- (lead time + safety days), not through AlertRule. Dropping the value keeps
-- the enum honest about what can actually be created.
--
-- Postgres cannot remove a value from an enum in place, so the type is
-- recreated. Safe here because no AlertRule row ever referenced STOCK_LOW —
-- it was unreachable from the UI, whose rule-type list is explicit.
ALTER TYPE "AlertRuleType" RENAME TO "AlertRuleType_old";

CREATE TYPE "AlertRuleType" AS ENUM (
  'NEGATIVE_MARGIN_PRODUCT',
  'AD_SPEND_THRESHOLD',
  'NET_MARGIN_BELOW',
  'MARKETPLACE_SYNC_FAILED',
  'DAILY_REVENUE_ABOVE'
);

ALTER TABLE "AlertRule"
  ALTER COLUMN "type" TYPE "AlertRuleType" USING ("type"::text::"AlertRuleType");

DROP TYPE "AlertRuleType_old";
