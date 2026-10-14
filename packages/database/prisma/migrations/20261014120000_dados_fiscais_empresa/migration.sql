-- Identificação da empresa para os relatórios ao contador (opcional).
ALTER TABLE "Workspace"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "taxRegime" TEXT;
