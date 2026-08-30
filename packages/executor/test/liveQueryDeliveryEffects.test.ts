import type { LiveQueryDeliveryRecord } from "@flarex/persistence-postgres";
import { Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  ackLiveQueryDeliveriesEffect,
  claimLiveQueryDeliveryBatchEffect,
  deadLetterStuckLiveQueryDeliveriesEffect,
  LiveQueryDeliveryForeignOperationError,
  makeLiveQueryDeliveryTimeEffect,
  runLiveQueryDeliveryBatchEffect,
  runLiveQueryDeliveryPromise,
} from "../src/liveQueryDeliveries";
import { runEffect } from "./effectTestRuntime";
import { memoryPersistence } from "./helpers/persistence";

describe("executor Effect-native live query delivery timing", () => {
  it("uses TestClock for separate claim and acknowledgement observations", async () => {
    const basePersistence = memoryPersistence();
    const claimedDates: Date[] = [];
    const expiryDates: Date[] = [];
    const deliveredDates: Date[] = [];
    const persistence = {
      ...basePersistence,
      async claimLiveQueryDeliveries(
        input: Parameters<typeof basePersistence.claimLiveQueryDeliveries>[0],
      ) {
        claimedDates.push(input.claimedAt);
        expiryDates.push(input.claimExpiresAt);
        return { deliveries: [], nextCursor: null, hasMore: false as const };
      },
      async markLiveQueryDeliveriesDelivered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDelivered
        >[0],
      ) {
        deliveredDates.push(input.deliveredAt);
        return { delivered: 0 };
      },
    };

    await runEffect(Effect.gen(function* () {
      const readTime = makeLiveQueryDeliveryTimeEffect(undefined);
      yield* TestClock.setTime(1_000);
      yield* claimLiveQueryDeliveryBatchEffect(persistence, readTime, {
        deploymentId: "deployment_delivery_effect",
        leaseDurationMs: 75,
      });
      yield* TestClock.setTime(2_000);
      yield* ackLiveQueryDeliveriesEffect(persistence, readTime, {
        deploymentId: "deployment_delivery_effect",
        deliveryIds: [],
      });
    }).pipe(Effect.provide(TestClock.layer())));

    expect(claimedDates).toEqual([new Date(1_000)]);
    expect(expiryDates).toEqual([new Date(1_075)]);
    expect(deliveredDates).toEqual([new Date(2_000)]);
  });

  it("keeps batch claim and acknowledgement as two time reads", async () => {
    const basePersistence = memoryPersistence();
    const delivery = liveQueryDelivery("deployment_delivery_batch_effect");
    const observedDates: Date[] = [];
    const selectedTimes = [new Date(100), new Date(200)];
    let timeReads = 0;
    const readTime = Effect.sync(() => {
      const selected = selectedTimes[timeReads];
      timeReads += 1;
      if (selected === undefined) {
        throw new Error("delivery batch read time more than twice");
      }
      return selected;
    });
    const persistence = {
      ...basePersistence,
      async claimLiveQueryDeliveries(
        input: Parameters<typeof basePersistence.claimLiveQueryDeliveries>[0],
      ) {
        observedDates.push(input.claimedAt);
        return {
          deliveries: [delivery],
          nextCursor: null,
          hasMore: false as const,
        };
      },
      async markLiveQueryDeliveriesDelivered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDelivered
        >[0],
      ) {
        observedDates.push(input.deliveredAt);
        return { delivered: 1 };
      },
    };

    await expect(runEffect(runLiveQueryDeliveryBatchEffect(
      persistence,
      readTime,
      {
        deploymentId: delivery.deploymentId,
        claimOwner: "delivery-effect-owner",
        async deliver() {},
      },
    ))).resolves.toMatchObject({ delivered: 1 });

    expect(timeReads).toBe(2);
    expect(observedDates).toEqual(selectedTimes);
  });

  it("does not acknowledge an empty or failed delivery batch", async () => {
    const basePersistence = memoryPersistence();
    const delivery = liveQueryDelivery("deployment_delivery_failure_effect");
    const deliveryFailure = new Error("delivery failed");
    let timeReads = 0;
    let acknowledgementCalls = 0;
    const readTime = Effect.sync(() => {
      timeReads += 1;
      return new Date(timeReads * 100);
    });
    const emptyPersistence = {
      ...basePersistence,
      async claimLiveQueryDeliveries() {
        return { deliveries: [], nextCursor: null, hasMore: false as const };
      },
      async markLiveQueryDeliveriesDelivered() {
        acknowledgementCalls += 1;
        return { delivered: 0 };
      },
    };

    await expect(runEffect(runLiveQueryDeliveryBatchEffect(
      emptyPersistence,
      readTime,
      {
        deploymentId: "deployment_delivery_empty_effect",
        claimOwner: "empty-effect-owner",
        async deliver() {
          throw new Error("empty page must not deliver");
        },
      },
    ))).resolves.toMatchObject({ deliveries: [], delivered: 0 });
    expect(timeReads).toBe(1);
    expect(acknowledgementCalls).toBe(0);

    const failedPersistence = {
      ...basePersistence,
      async claimLiveQueryDeliveries() {
        return {
          deliveries: [delivery],
          nextCursor: null,
          hasMore: false as const,
        };
      },
      async markLiveQueryDeliveriesDelivered() {
        acknowledgementCalls += 1;
        return { delivered: 1 };
      },
    };
    const result = await runEffect(Effect.result(
      runLiveQueryDeliveryBatchEffect(failedPersistence, readTime, {
        deploymentId: delivery.deploymentId,
        claimOwner: "failed-effect-owner",
        async deliver() {
          throw deliveryFailure;
        },
      }),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(
        LiveQueryDeliveryForeignOperationError,
      );
      expect(result.failure.cause).toBe(deliveryFailure);
    }
    expect(timeReads).toBe(2);
    expect(acknowledgementCalls).toBe(0);
  });

  it("suppresses acknowledgement and dead-letter time on no-read branches", async () => {
    const timeDefect = new Error("delivery time must not be read");
    const readTime = Effect.die(timeDefect);
    const basePersistence = memoryPersistence();
    const deliveredAt = new Date(300);
    const deliveredDates: Date[] = [];
    const persistence = {
      ...basePersistence,
      async markLiveQueryDeliveriesDelivered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDelivered
        >[0],
      ) {
        deliveredDates.push(input.deliveredAt);
        return { delivered: 0 };
      },
    };

    await runEffect(ackLiveQueryDeliveriesEffect(persistence, readTime, {
      deploymentId: "deployment_delivery_override_effect",
      deliveryIds: [],
      deliveredAt,
    }));
    await expect(runEffect(deadLetterStuckLiveQueryDeliveriesEffect(
      persistence,
      readTime,
      {
        olderThan: new Date(0),
        reason: "empty page",
      },
    ))).resolves.toMatchObject({ scanned: [], deadLettered: [] });

    expect(deliveredDates).toEqual([deliveredAt]);

    const first = liveQueryDelivery("deployment_dead_letter_override_a", "a");
    const second = liveQueryDelivery("deployment_dead_letter_override_b", "b");
    const deadLetteredAt = new Date(400);
    const deadLetteredDates: Date[] = [];
    const deadLetterPersistence = {
      ...basePersistence,
      async listStuckLiveQueryDeliveries() {
        return {
          deliveries: [first, second],
          nextCursor: null,
          hasMore: false,
        };
      },
      async markLiveQueryDeliveriesDeadLettered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDeadLettered
        >[0],
      ) {
        deadLetteredDates.push(input.deadLetteredAt);
        const delivery = input.deploymentId === first.deploymentId
          ? first
          : second;
        return { deadLettered: 1, deliveries: [delivery] };
      },
    };

    await runEffect(deadLetterStuckLiveQueryDeliveriesEffect(
      deadLetterPersistence,
      readTime,
      {
        olderThan: new Date(0),
        reason: "explicit evidence",
        deadLetteredAt,
      },
    ));
    expect(deadLetteredDates).toHaveLength(2);
    expect(deadLetteredDates[0]).toBe(deadLetteredAt);
    expect(deadLetteredDates[1]).toBe(deadLetteredAt);
  });

  it("shares one TestClock dead-letter Date across deployment groups", async () => {
    const basePersistence = memoryPersistence();
    const first = liveQueryDelivery("deployment_dead_letter_effect_a", "a");
    const second = liveQueryDelivery("deployment_dead_letter_effect_b", "b");
    const deadLetteredDates: Date[] = [];
    const persistence = {
      ...basePersistence,
      async listStuckLiveQueryDeliveries() {
        return {
          deliveries: [first, second],
          nextCursor: null,
          hasMore: false,
        };
      },
      async markLiveQueryDeliveriesDeadLettered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDeadLettered
        >[0],
      ) {
        deadLetteredDates.push(input.deadLetteredAt);
        const delivery = input.deploymentId === first.deploymentId
          ? first
          : second;
        return { deadLettered: 1, deliveries: [delivery] };
      },
    };

    await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(400);
      yield* deadLetterStuckLiveQueryDeliveriesEffect(
        persistence,
        makeLiveQueryDeliveryTimeEffect(undefined),
        { olderThan: new Date(0), reason: "stuck" },
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(deadLetteredDates).toHaveLength(2);
    expect(deadLetteredDates[0]).toBe(deadLetteredDates[1]);
    expect(deadLetteredDates).toEqual([new Date(400), new Date(400)]);
  });

  it("stops sequential dead-letter writes at the first failure", async () => {
    const basePersistence = memoryPersistence();
    const first = liveQueryDelivery("deployment_dead_letter_failure_a", "a");
    const second = liveQueryDelivery("deployment_dead_letter_failure_b", "b");
    const markFailure = new Error("dead-letter write failed");
    const markCalls: string[] = [];
    let timeReads = 0;
    const persistence = {
      ...basePersistence,
      async listStuckLiveQueryDeliveries() {
        return {
          deliveries: [first, second],
          nextCursor: null,
          hasMore: false,
        };
      },
      async markLiveQueryDeliveriesDeadLettered(
        input: Parameters<
          typeof basePersistence.markLiveQueryDeliveriesDeadLettered
        >[0],
      ): Promise<never> {
        markCalls.push(input.deploymentId);
        throw markFailure;
      },
    };

    await expect(runLiveQueryDeliveryPromise(
      deadLetterStuckLiveQueryDeliveriesEffect(
        persistence,
        Effect.sync(() => {
          timeReads += 1;
          return new Date(500);
        }),
        { olderThan: new Date(0), reason: "stuck" },
      ),
    )).rejects.toBe(markFailure);

    expect(timeReads).toBe(1);
    expect(markCalls).toEqual([first.deploymentId]);
  });
});

function liveQueryDelivery(
  deploymentId: string,
  deliveryId = "delivery_effect",
): LiveQueryDeliveryRecord {
  return {
    deploymentId,
    deliveryId,
    connectionId: `connection_${deliveryId}`,
    queryId: 1,
    payloadJson: null,
    deliveredAt: null,
    claimedAt: null,
    claimExpiresAt: null,
    claimOwner: null,
    attemptCount: 1,
    lastAttemptedAt: new Date(0),
    lastErrorStage: "fanout",
    lastError: "failed",
    deadLetteredAt: null,
    deadLetterReason: null,
    createdAt: new Date(0),
  };
}
