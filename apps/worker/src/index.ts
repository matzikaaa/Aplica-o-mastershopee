import { Worker } from "bullmq";
import { connection } from "./redis.js";
import { QUEUE_NAMES, type MarketplaceSyncJobData, type ComputeMetricsJobData, type WhatsappReportJobData, type WebhookProcessingJobData } from "./queues.js";
import { runMarketplaceSync } from "./jobs/sync-marketplace.js";
import { computeDailyMetrics } from "./jobs/compute-daily-metrics.js";
import { runWhatsappScheduler } from "./jobs/whatsapp-scheduler.js";
import { runAlertChecks } from "./jobs/check-alerts.js";
import { processWebhookEvent } from "./jobs/process-webhook.js";
import { registerScheduledJobs, enqueueMetricsForAllWorkspaces } from "./scheduler.js";

function log(message: string, context?: Record<string, unknown>) {
  // Structured logging (§52) — one JSON object per line, easy to ship to any log aggregator.
  console.log(JSON.stringify({ level: "info", message, ts: new Date().toISOString(), ...context }));
}

const marketplaceSyncWorker = new Worker<MarketplaceSyncJobData>(
  QUEUE_NAMES.marketplaceSync,
  async (job) => {
    log("sync.start", { jobId: job.id, accountId: job.data.marketplaceAccountId, type: job.data.type });
    await runMarketplaceSync(job.data);
    log("sync.done", { jobId: job.id });
  },
  { connection, concurrency: 5 },
);

const computeMetricsWorker = new Worker<ComputeMetricsJobData>(
  QUEUE_NAMES.computeMetrics,
  async (job) => {
    if (job.data.workspaceId === "*") {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      await enqueueMetricsForAllWorkspaces(today);
      await enqueueMetricsForAllWorkspaces(yesterday);
      return;
    }
    await computeDailyMetrics(job.data);
  },
  { connection, concurrency: 10 },
);

const whatsappWorker = new Worker<WhatsappReportJobData>(
  QUEUE_NAMES.whatsappReport,
  async () => {
    await runWhatsappScheduler();
  },
  { connection, concurrency: 1 },
);

const webhookWorker = new Worker<WebhookProcessingJobData>(
  QUEUE_NAMES.webhookProcessing,
  async (job) => {
    await processWebhookEvent(job.data);
  },
  { connection, concurrency: 20 },
);

for (const worker of [marketplaceSyncWorker, computeMetricsWorker, whatsappWorker, webhookWorker]) {
  worker.on("failed", (job, err) => {
    log("job.failed", { queue: worker.name, jobId: job?.id, error: err.message });
  });
}

// Alert checks piggyback on the same 15-minute cadence as metrics — no dedicated queue needed.
setInterval(() => {
  runAlertChecks().catch((err) => log("alerts.error", { error: err.message }));
}, 15 * 60 * 1000);

await registerScheduledJobs();
log("worker.started");
