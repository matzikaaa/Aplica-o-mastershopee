-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_IN', 'SALE_OUT', 'RETURN_IN', 'CANCELLATION_IN', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "AlertRuleType" ADD VALUE 'STOCK_LOW';

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "supplierName" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "safetyDays" INTEGER NOT NULL DEFAULT 0,
    "lowStockNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderItemId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_productId_key" ON "StockItem"("productId");

-- CreateIndex
CREATE INDEX "StockItem_workspaceId_idx" ON "StockItem"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_orderItemId_key" ON "StockMovement"("orderItemId");

-- CreateIndex
CREATE INDEX "StockMovement_workspaceId_occurredAt_idx" ON "StockMovement"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_stockItemId_occurredAt_idx" ON "StockMovement"("stockItemId", "occurredAt");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
