import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@mastershopee/database";
import { processWebhookEvent } from "../../process-webhook.js";
import { marketplaceSyncQueue } from "../../../queues.js";
import { cleanupTestWorkspace, createTestWorkspace } from "./helpers.js";

describe("processWebhookEvent — real Postgres + Redis/BullMQ (§35)", () => {
  let workspaceId: string | undefined;
  const enqueuedJobIds: string[] = [];

  afterEach(async () => {
    for (const id of enqueuedJobIds.splice(0)) {
      const job = await marketplaceSyncQueue.getJob(id);
      await job?.remove().catch(() => {});
    }
    if (workspaceId) await cleanupTestWorkspace(workspaceId);
    workspaceId = undefined;
  });

  it("marks the event processed and enqueues a real incremental sync job on the marketplace-sync queue", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;

    const event = await prisma.webhookEvent.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: marketplaceAccount.marketplace,
        externalEventId: "evt-1",
        eventType: "order_status_changed",
        payload: {},
      },
    });

    const countsBefore = await marketplaceSyncQueue.getJobCounts("waiting", "delayed");

    await processWebhookEvent({ webhookEventId: event.id });

    const updated = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.processedAt).not.toBeNull();

    const countsAfter = await marketplaceSyncQueue.getJobCounts("waiting", "delayed");
    expect((countsAfter.waiting ?? 0) + (countsAfter.delayed ?? 0)).toBe((countsBefore.waiting ?? 0) + (countsBefore.delayed ?? 0) + 1);

    const jobs = await marketplaceSyncQueue.getJobs(["waiting", "delayed"]);
    const ourJob = jobs.find((j) => j.data.marketplaceAccountId === marketplaceAccount.id && j.data.type === "INCREMENTAL");
    expect(ourJob).toBeDefined();
    if (ourJob?.id) enqueuedJobIds.push(ourJob.id);
  });

  it("is idempotent — re-processing an already-processed event is a no-op and enqueues nothing new", async () => {
    const { workspace, marketplaceAccount } = await createTestWorkspace();
    workspaceId = workspace.id;

    const event = await prisma.webhookEvent.create({
      data: {
        workspaceId: workspace.id,
        marketplaceAccountId: marketplaceAccount.id,
        marketplace: marketplaceAccount.marketplace,
        externalEventId: "evt-2",
        eventType: "order_status_changed",
        payload: {},
      },
    });

    await processWebhookEvent({ webhookEventId: event.id });
    const afterFirst = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    const jobsAfterFirst = await marketplaceSyncQueue.getJobs(["waiting", "delayed"]);
    const ourJob = jobsAfterFirst.find((j) => j.data.marketplaceAccountId === marketplaceAccount.id && j.data.type === "INCREMENTAL");
    if (ourJob?.id) enqueuedJobIds.push(ourJob.id);
    const countBeforeRerun = jobsAfterFirst.length;

    await processWebhookEvent({ webhookEventId: event.id }); // simulates a marketplace retrying the same webhook delivery

    const afterSecond = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterSecond.processedAt?.getTime()).toBe(afterFirst.processedAt?.getTime());

    const jobsAfterSecond = await marketplaceSyncQueue.getJobs(["waiting", "delayed"]);
    expect(jobsAfterSecond.length).toBe(countBeforeRerun); // no duplicate sync enqueued
  });
});
