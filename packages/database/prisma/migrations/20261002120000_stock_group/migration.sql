-- Agrupamento de estoque: SKUs de embalagens diferentes que consomem o mesmo
-- produto físico. `unitsPerSale` é quantas unidades-base cada venda do SKU
-- consome; 1 é o comportamento de hoje, então o padrão não muda nada para
-- quem já existe.
ALTER TABLE "Product" ADD COLUMN "stockParentId" TEXT;
ALTER TABLE "Product" ADD COLUMN "unitsPerSale" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Product_stockParentId_idx" ON "Product"("stockParentId");

-- ON DELETE SET NULL: apagar o produto-base não pode apagar os SKUs que
-- apontavam para ele — eles voltam a ter estoque próprio, que é o estado
-- anterior ao agrupamento, e não somem com o histórico junto.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stockParentId_fkey"
  FOREIGN KEY ("stockParentId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
