import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "../src";
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
});
