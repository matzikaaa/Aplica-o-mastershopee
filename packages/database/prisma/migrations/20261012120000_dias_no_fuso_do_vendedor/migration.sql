-- Pedidos importados por planilha: o horário do relatório (o do vendedor,
-- em Brasília) foi gravado como se fosse UTC. Enquanto o dia também era
-- cortado em UTC, os dois erros se anulavam; com o dia no fuso do vendedor,
-- a venda da madrugada iria para o dia anterior. Reinterpreta o horário
-- gravado no fuso do workspace e guarda o instante real.
UPDATE "Order" o
SET "orderedAt" = (o."orderedAt" AT TIME ZONE w."timezone") AT TIME ZONE 'UTC'
FROM "Workspace" w, "MarketplaceAccount" a
WHERE o."workspaceId" = w."id"
  AND o."marketplaceAccountId" = a."id"
  AND a."externalShopId" LIKE 'manual-import:%';

-- Toda métrica guardada mudou de regra: o dia passa a ser o do vendedor, e o
-- lucro por produto passa a ratear comissão, taxas e frete do pedido. Marca
-- cada workspace para recálculo desde a primeira venda (um dia antes, para o
-- recorte do fuso); a aplicação refaz em fatias.
UPDATE "Workspace" w
SET "metricsRecomputeFrom" = sub."primeiroDia"
FROM (
  SELECT "workspaceId", (MIN("orderedAt") - INTERVAL '1 day')::date AS "primeiroDia"
  FROM "Order"
  GROUP BY "workspaceId"
) sub
WHERE w."id" = sub."workspaceId";
