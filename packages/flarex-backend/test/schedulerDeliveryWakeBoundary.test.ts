import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSchedulerDeliveryWakeFailureBodyText,
  schedulerDeliveryWakeBoundaryErrorToHttpError,
  SchedulerDeliveryWakeRequestError,
  wakeDeliveryEffect,
} from "../src/scheduler/DeliveryWakeBoundary";

describe("scheduler delivery wake boundary", () => {
  it("decodes successful DeliveryDO wake responses", async () => {
    const requests: unknown[] = [];
    const result = await Effect.runPromise(wakeDeliveryEffect(
      async input => {
        requests.push(input);
        return Response.json({ deploymentId: input.deploymentId, claimed: 1 });
      },
      {
        deploymentId: "deployment-a",
        limit: 10,
        maxBatches: 2,
      },
    ));

    expect(result).toEqual({
      woken: true,
      status: 200,
      result: { deploymentId: "deployment-a", claimed: 1 },
      error: null,
    });
    expect(requests).toEqual([{
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
    }]);
  });

  it("preserves DeliveryDO drain failure envelopes as wake results", async () => {
    const failure = {
      deploymentId: "deployment-a",
      error: "Ack failed.",
      failure: {
        stage: "ack",
        status: 503,
        error: "Ack failed.",
      },
      summary: {
        batches: 1,
        claimed: 2,
        delivered: 1,
        skipped: 0,
        staleSkipped: 0,
        acked: 1,
        pendingAck: 1,
        hasMore: false,
        failure: {
          stage: "ack",
          status: 503,
          error: "Ack failed.",
        },
      },
    };

    const result = await Effect.runPromise(wakeDeliveryEffect(
      async () => Response.json(failure, { status: 503 }),
      {
        deploymentId: "deployment-a",
        limit: 10,
      },
    ));

    expect(result).toEqual({
      woken: false,
      status: 503,
      result: failure,
      error: "Ack failed.",
      failure: failure.failure,
    });
  });

  it("decodes failed wake response bodies through a typed Effect bridge", async () => {
    await expect(Effect.runPromise(decodeSchedulerDeliveryWakeFailureBodyText("")))
      .resolves.toBeNull();
    await expect(Effect.runPromise(decodeSchedulerDeliveryWakeFailureBodyText(JSON.stringify({
      error: "Delivery wake failed.",
    })))).resolves.toEqual({
      error: "Delivery wake failed.",
    });
    await expect(Effect.runPromise(decodeSchedulerDeliveryWakeFailureBodyText("plain failure")))
      .resolves.toBe("plain failure");
  });

  it("keeps wake request failures typed until adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(wakeDeliveryEffect(
      async () => {
        throw new Error("wake unavailable");
      },
      {
        deploymentId: "deployment-a",
        limit: 10,
      },
    )));

    expect(failure).toBeInstanceOf(SchedulerDeliveryWakeRequestError);
    expect(failure).toMatchObject({
      _tag: "SchedulerDeliveryWakeRequestError",
      deploymentId: "deployment-a",
      message: "wake unavailable",
    });
    expect(schedulerDeliveryWakeBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 500,
      message: "wake unavailable",
    });
  });
});
