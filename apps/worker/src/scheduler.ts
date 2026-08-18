import { prisma } from "@mastershopee/database";
import { computeMetricsQueue, whatsappReportQueue } from "./queues.js";

/**
 * Registers the recurring (cron-like) jobs this worker owns (§54, §64).
 * BullMQ's repeatable jobs survive restarts (state lives in Redis), so
 * this is safe to call on every worker boot without creating duplicates.
 */
export async function registerScheduledJobs(): Promise<void> {
  // Every minute: check which workspaces' WhatsApp daily-report time matches now (§64).
  await whatsappReportQueue.add(
    "tick",
    { workspaceId: "*" },
    { repeat: { pattern: "* * * * *" }, jobId: "whatsapp-scheduler-tick" },
  );

  // Every 15 minutes: recompute today's metrics for every workspace with
  // marketplace data, so the dashboard never drifts far from source data.
  await computeMetricsQueue.add(
    "recompute-today-all-workspaces",
    { workspaceId: "*", date: "*" },
    { repeat: { pattern: "*/15 * * * *" }, jobId: "compute-metrics-tick" },
  );
}

/** Fans the "*" tick job out into one real compute-metrics job per active workspace/day. */
export async function enqueueMetricsForAllWorkspaces(date: string): Promise<void> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const w of workspaces) {
    await computeMetricsQueue.add("compute", { workspaceId: w.id, date });
  }
}
