import { describe, expect, it, vi } from "vitest";

import { createFlarexExecutor, OutboxDeliveryPolicyError } from "../src";
import { memoryPersistence } from "./helpers/persistence";

describe("executor outbox delivery", () => {
  it("lists and marks undelivered outbox events", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await persistence.insertOutboxEvent({
      deploymentId: "deployment_outbox",
      ts: 10,
      sequence: 0,
      event: {
        type: "commit",
        deploymentId: "deployment_outbox",
        commitTs: 10,
        source: "invoke:messages:create",
        changedTableIds: [1],
        changedDocumentIds: ["1:message"],
        writeSummary: { writes: [] },
      },
    });

    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_outbox",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0, deliveredAt: null }],
      nextCursor: null,
      hasMore: false,
    });

    await expect(
      executor.markOutboxEventsDelivered({
        deploymentId: "deployment_outbox",
        events: [{ ts: 10, sequence: 0 }],
        deliveredAt: new Date("2026-06-20T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ delivered: 1 });

    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_outbox",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("runs an outbox delivery batch and marks delivered after the handler succeeds", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const delivered: unknown[] = [];

    await insertCommitEvent(persistence, {
      deploymentId: "deployment_batch_success",
      ts: 10,
      documentId: "1:message_a",
    });
    await insertCommitEvent(persistence, {
      deploymentId: "deployment_batch_success",
      ts: 11,
      documentId: "1:message_b",
    });

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_batch_success",
        limit: 1,
        deliveredAt: new Date("2026-06-20T00:00:00.000Z"),
        async deliver(events) {
          delivered.push(...events.map((event) => event.event));
        },
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0 }],
      delivered: 1,
      nextCursor: { ts: 10, sequence: 0 },
      hasMore: true,
    });
    expect(delivered).toMatchObject([
      {
        type: "commit",
        deploymentId: "deployment_batch_success",
        commitTs: 10,
      },
    ]);

    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_batch_success",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 11, sequence: 0, deliveredAt: null }],
    });
  });

  it("leaves outbox events undelivered when the handler fails", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await insertCommitEvent(persistence, {
      deploymentId: "deployment_batch_failure",
      ts: 10,
      documentId: "1:message",
    });

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_batch_failure",
        limit: 10,
        async deliver() {
          throw new Error("delivery failed");
        },
      }),
    ).rejects.toThrow("delivery failed");

    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_batch_failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0, deliveredAt: null }],
    });
  });

  it("does not call the handler for an empty outbox batch", async () => {
    const executor = createFlarexExecutor({ persistence: memoryPersistence() });
    const deliver = vi.fn<() => Promise<void>>(async () => {});

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_empty_batch",
        deliver,
      }),
    ).resolves.toEqual({
      events: [],
      delivered: 0,
      nextCursor: null,
      hasMore: false,
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects invalid outbox delivery batch limits", async () => {
    const executor = createFlarexExecutor({ persistence: memoryPersistence() });

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_invalid_limit",
        limit: 0,
        async deliver() {},
      }),
    ).rejects.toThrow(OutboxDeliveryPolicyError);
  });
});

async function insertCommitEvent(
  persistence: ReturnType<typeof memoryPersistence>,
  input: {
    deploymentId: string;
    ts: number;
    documentId: string;
  },
): Promise<void> {
  await persistence.insertOutboxEvent({
    deploymentId: input.deploymentId,
    ts: input.ts,
    sequence: 0,
    event: {
      type: "commit",
      deploymentId: input.deploymentId,
      commitTs: input.ts,
      source: "invoke:messages:create",
      changedTableIds: [1],
      changedDocumentIds: [input.documentId],
      writeSummary: { writes: [] },
    },
  });
}
