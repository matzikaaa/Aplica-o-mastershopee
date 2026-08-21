-- CreateTable
CREATE TABLE "ProductSkuAlias" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "mergedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSkuAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSkuAlias_productId_idx" ON "ProductSkuAlias"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSkuAlias_workspaceId_sku_key" ON "ProductSkuAlias"("workspaceId", "sku");

-- AddForeignKey
ALTER TABLE "ProductSkuAlias" ADD CONSTRAINT "ProductSkuAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSkuAlias" ADD CONSTRAINT "ProductSkuAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
