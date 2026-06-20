import { describe, expect, it } from "vitest";

import type { OutboxEventRecord } from "@flarex/persistence-postgres";
import {
  applyOutboxEventsToFreshnessMirror,
  checkReadSetFreshness,
  createFreshnessDeliveryHandler,
  createMemoryFreshnessMirrorStore,
  createPostgresFreshnessDeliveryHandler,
  createPostgresFreshnessMirrorStore,
  FreshnessOutboxEventShapeError,
} from "../src";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";

describe("freshness outbox projector", () => {
  it("applies commit outbox events into document and table versions", async () => {
    const store = createMemoryFreshnessMirrorStore();

    await expect(
      applyOutboxEventsToFreshnessMirror({
        store,
        events: [
          commitOutboxEvent({
            deploymentId: "deployment_freshness",
            ts: 10,
            commitTs: 10,
            tableIds: [1],
            documentIds: ["1:message"],
          }),
        ],
      }),
    ).resolves.toMatchObject({
      processed: 1,
      skipped: 0,
      documentVersions: [
        {
          deploymentId: "deployment_freshness",
          documentId: "1:message",
          version: 10,
          outboxTs: 10,
          outboxSequence: 0,
        },
      ],
      tableVersions: [
        {
          deploymentId: "deployment_freshness",
          tableId: 1,
          version: 10,
          outboxTs: 10,
          outboxSequence: 0,
        },
      ],
    });
    expect(
      store.getDocumentVersion("deployment_freshness", "1:message"),
    ).toMatchObject({
      version: 10,
      outboxTs: 10,
    });
    expect(store.getTableVersion("deployment_freshness", 1)).toMatchObject({
      version: 10,
      outboxTs: 10,
    });
  });

  it("skips replayed outbox events by event key", async () => {
    const store = createMemoryFreshnessMirrorStore();
    const event = commitOutboxEvent({
      deploymentId: "deployment_replay",
      ts: 10,
      commitTs: 10,
      tableIds: [1],
      documentIds: ["1:message"],
    });

    await applyOutboxEventsToFreshnessMirror({ store, events: [event] });
    await expect(
      applyOutboxEventsToFreshnessMirror({ store, events: [event] }),
    ).resolves.toEqual({
      processed: 0,
      skipped: 1,
      documentVersions: [],
      tableVersions: [],
    });
    expect(
      store.getProcessedEvent({
        deploymentId: "deployment_replay",
        ts: 10,
        sequence: 0,
      }),
    ).toBe(true);
  });

  it("does not regress a freshness version when older events arrive later", async () => {
    const store = createMemoryFreshnessMirrorStore();

    await applyOutboxEventsToFreshnessMirror({
      store,
      events: [
        commitOutboxEvent({
          deploymentId: "deployment_ordering",
          ts: 20,
          commitTs: 20,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
        commitOutboxEvent({
          deploymentId: "deployment_ordering",
          ts: 10,
          commitTs: 10,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ],
    });

    expect(
      store.getDocumentVersion("deployment_ordering", "1:message"),
    ).toMatchObject({
      version: 20,
      outboxTs: 20,
    });
    expect(store.getTableVersion("deployment_ordering", 1)).toMatchObject({
      version: 20,
      outboxTs: 20,
    });
  });

  it("rejects malformed outbox events", async () => {
    const store = createMemoryFreshnessMirrorStore();

    await expect(
      applyOutboxEventsToFreshnessMirror({
        store,
        events: [
          {
            deploymentId: "deployment_bad_event",
            ts: 10,
            sequence: 0,
            event: {
              type: "notCommit",
            },
            deliveredAt: null,
          },
        ],
      }),
    ).rejects.toThrow(FreshnessOutboxEventShapeError);
  });

  it("projects outbox events through durable Postgres freshness storage", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const store = createPostgresFreshnessMirrorStore(persistence);

    await expect(
      applyOutboxEventsToFreshnessMirror({
        store,
        events: [
          commitOutboxEvent({
            deploymentId: "deployment_durable_freshness",
            ts: 10,
            commitTs: 10,
            tableIds: [1],
            documentIds: ["1:message"],
          }),
        ],
      }),
    ).resolves.toMatchObject({
      processed: 1,
      skipped: 0,
      documentVersions: [
        {
          deploymentId: "deployment_durable_freshness",
          documentId: "1:message",
          version: 10,
        },
      ],
      tableVersions: [
        {
          deploymentId: "deployment_durable_freshness",
          tableId: 1,
          version: 10,
        },
      ],
    });

    const restartedStore = createPostgresFreshnessMirrorStore(persistence);
    await expect(
      applyOutboxEventsToFreshnessMirror({
        store: restartedStore,
        events: [
          commitOutboxEvent({
            deploymentId: "deployment_durable_freshness",
            ts: 10,
            commitTs: 10,
            tableIds: [1],
            documentIds: ["1:message"],
          }),
        ],
      }),
    ).resolves.toMatchObject({
      processed: 0,
      skipped: 1,
    });
    await expect(
      restartedStore.getDocumentVersion(
        "deployment_durable_freshness",
        "1:message",
      ),
    ).resolves.toMatchObject({
      version: 10,
      outboxTs: 10,
      outboxSequence: 0,
    });
    await expect(
      restartedStore.getProcessedEvent({
        deploymentId: "deployment_durable_freshness",
        ts: 10,
        sequence: 0,
      }),
    ).resolves.toBe(true);
  });

  it("creates a reusable freshness delivery handler", async () => {
    const store = createMemoryFreshnessMirrorStore();
    const deliver = createFreshnessDeliveryHandler(store);

    await expect(
      deliver([
        commitOutboxEvent({
          deploymentId: "deployment_delivery_handler",
          ts: 10,
          commitTs: 10,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ]),
    ).resolves.toMatchObject({
      processed: 1,
      skipped: 0,
    });
    expect(
      store.getDocumentVersion("deployment_delivery_handler", "1:message"),
    ).toMatchObject({
      version: 10,
    });
  });

  it("creates a reusable Postgres freshness delivery handler", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deliver = createPostgresFreshnessDeliveryHandler(persistence);

    await expect(
      deliver([
        commitOutboxEvent({
          deploymentId: "deployment_postgres_delivery_handler",
          ts: 10,
          commitTs: 10,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ]),
    ).resolves.toMatchObject({
      processed: 1,
      skipped: 0,
    });
    await expect(
      persistence.getDocumentFreshnessVersion(
        "deployment_postgres_delivery_handler",
        "1:message",
      ),
    ).resolves.toMatchObject({
      version: 10,
      outboxTs: 10,
      outboxSequence: 0,
    });
  });

  it("checks fresh document and table read sets", async () => {
    const store = createMemoryFreshnessMirrorStore();
    await applyOutboxEventsToFreshnessMirror({
      store,
      events: [
        commitOutboxEvent({
          deploymentId: "deployment_fresh_readset",
          ts: 10,
          commitTs: 10,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ],
    });

    await expect(
      checkReadSetFreshness({
        store,
        deploymentId: "deployment_fresh_readset",
        readSet: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
          tables: [{ tableId: 1, observedTs: 10 }],
        },
      }),
    ).resolves.toEqual({
      status: "fresh",
      stale: [],
      unsupported: [],
    });
  });

  it("detects stale document and table read sets", async () => {
    const store = createMemoryFreshnessMirrorStore();
    await applyOutboxEventsToFreshnessMirror({
      store,
      events: [
        commitOutboxEvent({
          deploymentId: "deployment_stale_readset",
          ts: 20,
          commitTs: 20,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ],
    });

    await expect(
      checkReadSetFreshness({
        store,
        deploymentId: "deployment_stale_readset",
        readSet: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
          tables: [{ tableId: 1, observedTs: 10 }],
        },
      }),
    ).resolves.toEqual({
      status: "stale",
      stale: [
        {
          kind: "document",
          id: "1:message",
          observedTs: 10,
          version: 20,
        },
        {
          kind: "table",
          id: "1",
          observedTs: 10,
          version: 20,
        },
      ],
      unsupported: [],
    });
  });

  it("treats missing-document reads as stale after later writes", async () => {
    const store = createMemoryFreshnessMirrorStore();
    await applyOutboxEventsToFreshnessMirror({
      store,
      events: [
        commitOutboxEvent({
          deploymentId: "deployment_missing_doc_readset",
          ts: 20,
          commitTs: 20,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ],
    });

    await expect(
      checkReadSetFreshness({
        store,
        deploymentId: "deployment_missing_doc_readset",
        readSet: {
          documents: [{ tableId: 1, id: "1:message", observedTs: null }],
        },
      }),
    ).resolves.toMatchObject({
      status: "stale",
      stale: [
        {
          kind: "document",
          id: "1:message",
          observedTs: null,
          version: 20,
        },
      ],
    });
  });

  it("reports index read sets as unsupported", async () => {
    const store = createMemoryFreshnessMirrorStore();

    await expect(
      checkReadSetFreshness({
        store,
        deploymentId: "deployment_index_readset",
        readSet: {
          indexes: [{ indexId: 1, observedTs: 10 }],
        },
      }),
    ).resolves.toEqual({
      status: "unsupported",
      stale: [],
      unsupported: [
        {
          kind: "index",
          indexId: 1,
          reason: "index/range freshness is not implemented yet",
        },
      ],
    });
  });

  it("checks durable Postgres read-set freshness", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const store = createPostgresFreshnessMirrorStore(persistence);

    await applyOutboxEventsToFreshnessMirror({
      store,
      events: [
        commitOutboxEvent({
          deploymentId: "deployment_durable_readset",
          ts: 20,
          commitTs: 20,
          tableIds: [1],
          documentIds: ["1:message"],
        }),
      ],
    });

    await expect(
      checkReadSetFreshness({
        store,
        deploymentId: "deployment_durable_readset",
        readSet: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
          tables: [{ tableId: 1, observedTs: 20 }],
        },
      }),
    ).resolves.toEqual({
      status: "stale",
      stale: [
        {
          kind: "document",
          id: "1:message",
          observedTs: 10,
          version: 20,
        },
      ],
      unsupported: [],
    });
  });
});

function commitOutboxEvent(input: {
  deploymentId: string;
  ts: number;
  commitTs: number;
  tableIds: number[];
  documentIds: string[];
}): OutboxEventRecord {
  return {
    deploymentId: input.deploymentId,
    ts: input.ts,
    sequence: 0,
    event: {
      type: "commit",
      deploymentId: input.deploymentId,
      commitTs: input.commitTs,
      source: "invoke:messages:create",
      changedTableIds: input.tableIds,
      changedDocumentIds: input.documentIds,
      writeSummary: { writes: [] },
    },
    deliveredAt: null,
  };
}
