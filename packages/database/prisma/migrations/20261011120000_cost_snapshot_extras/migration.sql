-- Embalagem, custo operacional, outros custos e imposto congelados no item,
-- como o custo unitário já era.
ALTER TABLE "OrderItem"
  ADD COLUMN "packagingCostSnapshot" DECIMAL(14,4),
  ADD COLUMN "operationalCostSnapshot" DECIMAL(14,4),
  ADD COLUMN "otherCostsSnapshot" DECIMAL(14,4),
  ADD COLUMN "taxPercentSnapshot" DECIMAL(7,4);

ALTER TABLE "Workspace" ADD COLUMN "metricsRecomputeFrom" DATE;

-- Itens que já têm custo unitário recebem o resto do MESMO registro de custo
-- que valia na data da venda. Itens ainda sem custo ficam como estão: o
-- preenchimento de quando o custo for cadastrado já grava tudo junto.
WITH alvo AS (
  SELECT oi."id",
    (
      SELECT c."id"
      FROM "ProductCost" c
      WHERE c."productId" = oi."productId" AND c."effectiveFrom" <= o."orderedAt"
      ORDER BY c."effectiveFrom" DESC
      LIMIT 1
    ) AS "costId"
  FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
  WHERE oi."productId" IS NOT NULL AND oi."unitCostSnapshot" IS NOT NULL
)
UPDATE "OrderItem" oi
SET "packagingCostSnapshot" = c."packagingCost",
    "operationalCostSnapshot" = c."operationalCost",
    "otherCostsSnapshot" = c."otherCosts",
    "taxPercentSnapshot" = c."taxPercent"
FROM alvo
JOIN "ProductCost" c ON c."id" = alvo."costId"
WHERE oi."id" = alvo."id";

-- As métricas guardadas foram calculadas sem esses custos. Marca, por
-- workspace, desde quando recalcular; a aplicação faz o resto em fatias.
UPDATE "Workspace" w
SET "metricsRecomputeFrom" = sub."primeiroDia"
FROM (
  SELECT o."workspaceId", MIN(o."orderedAt")::date AS "primeiroDia"
  FROM "Order" o
  JOIN "OrderItem" oi ON oi."orderId" = o."id"
  WHERE COALESCE(oi."packagingCostSnapshot", 0) <> 0
     OR COALESCE(oi."operationalCostSnapshot", 0) <> 0
     OR COALESCE(oi."otherCostsSnapshot", 0) <> 0
     OR COALESCE(oi."taxPercentSnapshot", 0) <> 0
  GROUP BY o."workspaceId"
) sub
WHERE w."id" = sub."workspaceId";
