import { describe, expect, it, vi } from "vitest";

import {
  applyOutboxEventsToFreshnessMirror,
  createFreshnessDeliveryHandler,
  createMemoryFreshnessMirrorStore,
} from "@flarex/freshness";
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

  it("projects outbox delivery batches into a freshness mirror", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const store = createMemoryFreshnessMirrorStore();

    await insertCommitEvent(persistence, {
      deploymentId: "deployment_freshness_pipeline",
      ts: 10,
      documentId: "1:message",
    });
    const deliver = createFreshnessDeliveryHandler(store);

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_freshness_pipeline",
        limit: 10,
        deliver: async (events) => {
          await deliver(events);
        },
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0 }],
      delivered: 1,
      nextCursor: null,
      hasMore: false,
    });
    expect(
      store.getDocumentVersion("deployment_freshness_pipeline", "1:message"),
    ).toMatchObject({
      version: 10,
      outboxTs: 10,
      outboxSequence: 0,
    });
    expect(store.getTableVersion("deployment_freshness_pipeline", 1)).toMatchObject({
      version: 10,
      outboxTs: 10,
      outboxSequence: 0,
    });
    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_freshness_pipeline",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("replays freshness projection safely after a delivery crash", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const store = createMemoryFreshnessMirrorStore();
    const replayResults: Array<{ processed: number; skipped: number }> = [];

    await insertCommitEvent(persistence, {
      deploymentId: "deployment_freshness_replay",
      ts: 10,
      documentId: "1:message",
    });

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_freshness_replay",
        limit: 10,
        async deliver(events) {
          replayResults.push(
            await applyOutboxEventsToFreshnessMirror({ store, events }),
          );
          throw new Error("crash after projection");
        },
      }),
    ).rejects.toThrow("crash after projection");
    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_freshness_replay",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0, deliveredAt: null }],
    });

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_freshness_replay",
        limit: 10,
        async deliver(events) {
          replayResults.push(
            await applyOutboxEventsToFreshnessMirror({ store, events }),
          );
        },
      }),
    ).resolves.toMatchObject({
      delivered: 1,
      hasMore: false,
    });
    expect(replayResults).toMatchObject([
      { processed: 1, skipped: 0 },
      { processed: 0, skipped: 1 },
    ]);
    expect(
      store.getProcessedEvent({
        deploymentId: "deployment_freshness_replay",
        ts: 10,
        sequence: 0,
      }),
    ).toBe(true);
    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_freshness_replay",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [],
    });
  });

  it("leaves outbox events undelivered when the handler fails", async () => {
    const persistence = memoryPersistence();
    let clockReads = 0;
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });

    await insertCommitEvent(persistence, {
      deploymentId: "deployment_batch_failure",
      ts: 10,
      documentId: "1:message",
    });

    const deliveryFailure = new Error("delivery failed");
    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_batch_failure",
        limit: 10,
        async deliver() {
          throw deliveryFailure;
        },
      }),
    ).rejects.toBe(deliveryFailure);

    await expect(
      executor.listUndeliveredOutboxEvents({
        deploymentId: "deployment_batch_failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0, deliveredAt: null }],
    });
    expect(clockReads).toBe(0);
  });

  it("does not call the handler for an empty outbox batch", async () => {
    const basePersistence = memoryPersistence();
    let markCalls = 0;
    const persistence = {
      ...basePersistence,
      async markOutboxEventsDelivered(): Promise<never> {
        markCalls += 1;
        throw new Error("mark must not run");
      },
    };
    let clockReads = 0;
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });
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
    expect(clockReads).toBe(0);
    expect(markCalls).toBe(0);
  });

  it("rejects invalid outbox delivery batch limits", async () => {
    const basePersistence = memoryPersistence();
    let listCalls = 0;
    const persistence = {
      ...basePersistence,
      async listUndeliveredOutboxEvents(): Promise<never> {
        listCalls += 1;
        throw new Error("list must not run");
      },
    };
    let clockReads = 0;
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });
    const deliver = vi.fn<() => Promise<void>>(async () => {});

    await expect(
      executor.runOutboxDeliveryBatch({
        deploymentId: "deployment_invalid_limit",
        limit: 0,
        deliver,
      }),
    ).rejects.toThrow(OutboxDeliveryPolicyError);
    expect(listCalls).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(clockReads).toBe(0);
  });

  it("preserves configured and explicit delivery Dates by identity", async () => {
    const basePersistence = memoryPersistence();
    await insertCommitEvent(basePersistence, {
      deploymentId: "deployment_configured_date",
      ts: 10,
      documentId: "1:message_configured",
    });
    await insertCommitEvent(basePersistence, {
      deploymentId: "deployment_explicit_date",
      ts: 20,
      documentId: "1:message_explicit",
    });
    const deliveredDates: Date[] = [];
    const persistence = {
      ...basePersistence,
      async markOutboxEventsDelivered(
        input: Parameters<
          typeof basePersistence.markOutboxEventsDelivered
        >[0],
      ) {
        deliveredDates.push(input.deliveredAt);
        return await basePersistence.markOutboxEventsDelivered(input);
      },
    };
    const configuredDate = new Date(100);
    const explicitDate = new Date(200);
    let clockReads = 0;
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return configuredDate;
        },
      },
    });

    await expect(executor.runOutboxDeliveryBatch({
      deploymentId: "deployment_configured_date",
      async deliver() {},
    })).resolves.toMatchObject({ delivered: 1 });
    await expect(executor.runOutboxDeliveryBatch({
      deploymentId: "deployment_explicit_date",
      deliveredAt: explicitDate,
      async deliver() {},
    })).resolves.toMatchObject({ delivered: 1 });

    expect(clockReads).toBe(1);
    expect(deliveredDates[0]).toBe(configuredDate);
    expect(deliveredDates[1]).toBe(explicitDate);
  });

  it("reads the mark deployment ID before event projection and time", async () => {
    const deploymentId = "deployment_mark_id_failure";
    const deploymentIdFailure = new Error("mark deployment ID read failed");
    const basePersistence = memoryPersistence();
    await insertCommitEvent(basePersistence, {
      deploymentId,
      ts: 10,
      documentId: "1:message_mark_id_failure",
    });
    let markCalls = 0;
    const persistence = {
      ...basePersistence,
      async markOutboxEventsDelivered(): Promise<never> {
        markCalls += 1;
        throw new Error("mark must not run");
      },
    };
    let deploymentIdReads = 0;
    let clockReads = 0;
    const deliver = vi.fn<() => Promise<void>>(async () => {});
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });
    const input = {
      get deploymentId(): string {
        deploymentIdReads += 1;
        if (deploymentIdReads === 2) {
          throw deploymentIdFailure;
        }
        return deploymentId;
      },
      deliver,
    };

    await expect(executor.runOutboxDeliveryBatch(input)).rejects.toBe(
      deploymentIdFailure,
    );
    expect(deliver).toHaveBeenCalledOnce();
    expect(deploymentIdReads).toBe(2);
    expect(clockReads).toBe(0);
    expect(markCalls).toBe(0);
  });

  it("preserves list, clock, and mark failures in delivery order", async () => {
    const listFailure = new Error("outbox list failed");
    const emptyPersistence = memoryPersistence();
    const listPersistence = {
      ...emptyPersistence,
      async listUndeliveredOutboxEvents(): Promise<never> {
        throw listFailure;
      },
    };
    let listClockReads = 0;
    const listDeliver = vi.fn<() => Promise<void>>(async () => {});
    const listExecutor = createFlarexExecutor({
      persistence: listPersistence,
      clock: {
        now: () => {
          listClockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(listExecutor.runOutboxDeliveryBatch({
      deploymentId: "deployment_list_failure",
      deliver: listDeliver,
    })).rejects.toBe(listFailure);
    expect(listDeliver).not.toHaveBeenCalled();
    expect(listClockReads).toBe(0);

    const clockFailure = new Error("outbox clock failed");
    const clockBasePersistence = memoryPersistence();
    await insertCommitEvent(clockBasePersistence, {
      deploymentId: "deployment_clock_failure",
      ts: 10,
      documentId: "1:message_clock_failure",
    });
    let clockMarkCalls = 0;
    const clockPersistence = {
      ...clockBasePersistence,
      async markOutboxEventsDelivered(): Promise<never> {
        clockMarkCalls += 1;
        throw new Error("mark must not run");
      },
    };
    const clockDeliver = vi.fn<() => Promise<void>>(async () => {});
    const clockExecutor = createFlarexExecutor({
      persistence: clockPersistence,
      clock: { now: () => { throw clockFailure; } },
    });

    await expect(clockExecutor.runOutboxDeliveryBatch({
      deploymentId: "deployment_clock_failure",
      deliver: clockDeliver,
    })).rejects.toBe(clockFailure);
    expect(clockDeliver).toHaveBeenCalledOnce();
    expect(clockMarkCalls).toBe(0);

    const markFailure = new Error("outbox mark failed");
    const markBasePersistence = memoryPersistence();
    await insertCommitEvent(markBasePersistence, {
      deploymentId: "deployment_mark_failure",
      ts: 10,
      documentId: "1:message_mark_failure",
    });
    const markPersistence = {
      ...markBasePersistence,
      async markOutboxEventsDelivered(): Promise<never> {
        throw markFailure;
      },
    };
    let markClockReads = 0;
    const markDeliver = vi.fn<() => Promise<void>>(async () => {});
    const markExecutor = createFlarexExecutor({
      persistence: markPersistence,
      clock: {
        now: () => {
          markClockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(markExecutor.runOutboxDeliveryBatch({
      deploymentId: "deployment_mark_failure",
      deliver: markDeliver,
    })).rejects.toBe(markFailure);
    expect(markDeliver).toHaveBeenCalledOnce();
    expect(markClockReads).toBe(1);
    await expect(markBasePersistence.listUndeliveredOutboxEvents({
      deploymentId: "deployment_mark_failure",
      limit: 1,
    })).resolves.toMatchObject({
      events: [{ ts: 10, sequence: 0, deliveredAt: null }],
    });
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
