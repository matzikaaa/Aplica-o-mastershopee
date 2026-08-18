import { Queue } from "bullmq";
import { connection } from "./redis.js";

export const QUEUE_NAMES = {
  marketplaceSync: "marketplace-sync",
  computeMetrics: "compute-daily-metrics",
  whatsappReport: "whatsapp-report",
  webhookProcessing: "webhook-processing",
} as const;

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 } as const,
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

export interface MarketplaceSyncJobData {
  marketplaceAccountId: string;
  type: "FULL" | "INCREMENTAL" | "PRODUCTS" | "ORDERS" | "ADS" | "FEES";
}

export interface ComputeMetricsJobData {
  workspaceId: string;
  date: string; // YYYY-MM-DD, in the workspace's timezone
}

export interface WhatsappReportJobData {
  workspaceId: string;
}

export interface WebhookProcessingJobData {
  webhookEventId: string;
}

export const marketplaceSyncQueue = new Queue<MarketplaceSyncJobData>(QUEUE_NAMES.marketplaceSync, {
  connection,
  defaultJobOptions,
});

export const computeMetricsQueue = new Queue<ComputeMetricsJobData>(QUEUE_NAMES.computeMetrics, {
  connection,
  defaultJobOptions,
});

export const whatsappReportQueue = new Queue<WhatsappReportJobData>(QUEUE_NAMES.whatsappReport, {
  connection,
  defaultJobOptions: { ...defaultJobOptions, attempts: 3 },
});

export const webhookProcessingQueue = new Queue<WebhookProcessingJobData>(QUEUE_NAMES.webhookProcessing, {
  connection,
  defaultJobOptions,
});
