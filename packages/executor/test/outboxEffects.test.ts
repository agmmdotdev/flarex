import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  makeOutboxTimeEffect,
  runOutboxDeliveryBatchEffect,
} from "../src/outbox";
import { runEffect } from "./effectTestRuntime";
import { memoryPersistence } from "./helpers/persistence";

describe("executor Effect-native outbox delivery", () => {
  it("uses TestClock for native delivery evidence", async () => {
    const basePersistence = memoryPersistence();
    await insertCommitEvent(basePersistence, "deployment_outbox_effect", 10);
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

    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(123);
      return yield* runOutboxDeliveryBatchEffect(
        persistence,
        makeOutboxTimeEffect(undefined),
        {
          deploymentId: "deployment_outbox_effect",
          async deliver() {},
        },
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(result).toMatchObject({ delivered: 1, hasMore: false });
    expect(deliveredDates).toEqual([new Date(123)]);
  });

  it("does not acquire time for empty pages or explicit delivery evidence", async () => {
    const timeDefect = new Error("outbox time must not be read");
    const emptyPersistence = memoryPersistence();

    await expect(runEffect(runOutboxDeliveryBatchEffect(
      emptyPersistence,
      Effect.die(timeDefect),
      {
        deploymentId: "deployment_outbox_empty_effect",
        async deliver() {},
      },
    ))).resolves.toEqual({
      events: [],
      delivered: 0,
      nextCursor: null,
      hasMore: false,
    });

    const basePersistence = memoryPersistence();
    await insertCommitEvent(basePersistence, "deployment_outbox_override", 20);
    const deliveredAt = new Date(456);
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

    await expect(runEffect(runOutboxDeliveryBatchEffect(
      persistence,
      Effect.die(timeDefect),
      {
        deploymentId: "deployment_outbox_override",
        deliveredAt,
        async deliver() {},
      },
    ))).resolves.toMatchObject({ delivered: 1 });
    expect(deliveredDates).toEqual([deliveredAt]);
  });
});

async function insertCommitEvent(
  persistence: ReturnType<typeof memoryPersistence>,
  deploymentId: string,
  ts: number,
): Promise<void> {
  await persistence.insertOutboxEvent({
    deploymentId,
    ts,
    sequence: 0,
    event: {
      type: "commit",
      deploymentId,
      commitTs: ts,
      source: "invoke:messages:create",
      changedTableIds: [1],
      changedDocumentIds: ["1:message"],
      writeSummary: { writes: [] },
    },
  });
}
