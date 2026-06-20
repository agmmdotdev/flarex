import { describe, expect, it } from "vitest";

import type { OutboxEventRecord } from "@flarex/persistence-postgres";
import {
  applyOutboxEventsToFreshnessMirror,
  createMemoryFreshnessMirrorStore,
  FreshnessOutboxEventShapeError,
} from "../src";

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
