-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "dailyReportEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dailyReportEmailTo" TEXT,
ADD COLUMN     "lastDailyEmailAt" TIMESTAMP(3);
