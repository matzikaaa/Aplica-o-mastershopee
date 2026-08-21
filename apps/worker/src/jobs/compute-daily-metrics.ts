import { computeDailyMetrics as compute } from "@mastershopee/database";
import type { ComputeMetricsJobData } from "../queues.js";

/**
 * Queue entry point. The aggregation itself lives in @mastershopee/database
 * so the scheduled job and the spreadsheet importer share one implementation
 * and can never disagree about a day's numbers (§60).
 */
export async function computeDailyMetrics(data: ComputeMetricsJobData): Promise<void> {
  await compute({ workspaceId: data.workspaceId, date: data.date });
}
