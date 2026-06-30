import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeConnectionLiveQueryDeliveryResultPayload,
  decodeLiveQueryDeliveryChangesFromBody,
  liveQueryDeliveriesByConnection,
  LiveQueryDeliveryChangePayloadError,
  liveQueryDeliveryChangePayloadErrorToHttpError,
  liveQueryDeliveryResultFromUnknown,
  liveQueryDeliveryResultPayloadErrorToHttpError,
  liveQueryDeliveryTargetErrorToHttpError,
} from "../src/liveQueryDelivery";
import {
  decodeConnectionLiveQueryDeliveryResponse,
  decodeLiveQueryDeliveryAckResponse,
  decodeLiveQueryDeliveryClaimResponse,
  liveQueryDeliveryResponseErrorToHttpError,
} from "../src/liveQueryDeliveryResponses";

describe("live query delivery result parsing", () => {
  it("decodes live query delivery changes through a shared typed boundary", async () => {
    await expect(Effect.runPromise(decodeLiveQueryDeliveryChangesFromBody({
      deliveries: [
        {
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-a",
          queryId: 1,
          functionPath: "users:get",
          argsJson: { id: "1:user" },
          resultJson: { name: "Ada" },
          previousResultHash: "previous",
          resultHash: "result",
        },
      ],
    }))).resolves.toEqual([
      {
        kind: "updated",
        deploymentId: "deployment-a",
        connectionId: "connection:deployment-a:session-a",
        queryId: 1,
        functionPath: "users:get",
        argsJson: { id: "1:user" },
        resultJson: { name: "Ada" },
        previousResultHash: "previous",
        resultHash: "result",
      },
    ]);
  });

  it("exposes shared typed live query delivery change payload failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(decodeLiveQueryDeliveryChangesFromBody({
      deliveries: [{ queryId: 1 }],
    })));

    expect(failure).toBeInstanceOf(LiveQueryDeliveryChangePayloadError);
    expect(failure).toMatchObject({
      _tag: "LiveQueryDeliveryChangePayloadError",
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });
    expect(liveQueryDeliveryChangePayloadErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });
  });

  it("exposes typed claim and ack response successes before payload parsing", async () => {
    await expect(
      Effect.runPromise(decodeLiveQueryDeliveryClaimResponse(Response.json({
        deliveries: [],
        hasMore: false,
        nextCursor: null,
      }))),
    ).resolves.toEqual({
      deliveries: [],
      hasMore: false,
      nextCursor: null,
    });

    await expect(
      Effect.runPromise(decodeLiveQueryDeliveryAckResponse(Response.json({ delivered: 2 }))),
    ).resolves.toEqual({ delivered: 2 });
  });

  it("exposes typed live query delivery response failures before HTTP mapping", async () => {
    await expect(
      Effect.runPromise(
        decodeConnectionLiveQueryDeliveryResponse(
          new Response("unavailable", { status: 503 }),
          "connection:test:down",
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryResponseError",
      operation: "connectionDelivery",
      status: 503,
      message: "ConnectionDO live query delivery failed for connection:test:down with status 503.",
      body: null,
    });
  });

  it("maps live query delivery response failures to the existing 502 adapter shape", async () => {
    await expect(
      Effect.runPromise(
        decodeLiveQueryDeliveryClaimResponse(new Response("unavailable", { status: 503 })).pipe(
          Effect.mapError(liveQueryDeliveryResponseErrorToHttpError),
        ),
      ),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 502,
      message: "Live query delivery claim failed with status 503.",
    });
  });

  it("exposes typed connection delivery payload successes before HTTP mapping", async () => {
    await expect(
      Effect.runPromise(decodeConnectionLiveQueryDeliveryResultPayload(
        {
          delivered: 0,
          skipped: 2,
          staleSkipped: 1,
          skipReasons: { missingQuery: 1 },
        },
        "connection:test:typed",
      )),
    ).resolves.toEqual({
      delivered: 0,
      skipped: 2,
      staleSkipped: 1,
      skipReasons: { missingQuery: 1, stale: 1 },
    });
  });

  it("exposes typed connection delivery payload failures before HTTP mapping", async () => {
    await expect(
      Effect.runPromise(decodeConnectionLiveQueryDeliveryResultPayload(
        {
          delivered: 0,
          skipped: 2,
          staleSkipped: 1,
          skipReasons: { stale: 2 },
        },
        "connection:test:mismatch",
      )),
    ).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryResultPayloadError",
      connectionId: "connection:test:mismatch",
      status: 502,
      message: "connection:test:mismatch.staleSkipped must match connection:test:mismatch.skipReasons.stale when both are present.",
    });
  });

  it("maps connection delivery payload failures to the existing 502 adapter shape", async () => {
    await expect(
      Effect.runPromise(
        decodeConnectionLiveQueryDeliveryResultPayload(
          { delivered: 1, skipped: -1 },
          "connection:test:bad",
        ).pipe(
          Effect.mapError(liveQueryDeliveryResultPayloadErrorToHttpError),
        ),
      ),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 502,
      message: "connection:test:bad.skipped must be a non-negative integer.",
    });
  });

  it("exposes typed delivery target failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(liveQueryDeliveriesByConnection(
      "deployment-a",
      [
        {
          kind: "updated",
          deploymentId: "deployment-b",
          connectionId: "connection:deployment-b:session-a",
          queryId: 1,
          functionPath: "users:get",
          argsJson: {},
          resultJson: { ok: true },
          previousResultHash: "previous",
          resultHash: "result",
        },
      ],
    ))).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryTargetError",
      deploymentId: "deployment-a",
      deliveryDeploymentId: "deployment-b",
      connectionId: "connection:deployment-b:session-a",
      message: "Live query delivery deploymentId deployment-b does not match route deploymentId deployment-a.",
    });
  });

  it("maps delivery target failures to the existing 400 adapter shape", async () => {
    const failure = await Effect.runPromise(Effect.flip(liveQueryDeliveriesByConnection(
      "deployment-a",
      [
        {
          kind: "updated",
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-b:session-a",
          queryId: 1,
          functionPath: "users:get",
          argsJson: {},
          resultJson: { ok: true },
          previousResultHash: "previous",
          resultHash: "result",
        },
      ],
    )));

    expect(liveQueryDeliveryTargetErrorToHttpError(failure)).toMatchObject({
      status: 400,
      message: "Live query delivery connectionId connection:deployment-b:session-a is not scoped to deployment deployment-a.",
    });
  });

  it("normalizes legacy staleSkipped responses into skip reasons", () => {
    expect(liveQueryDeliveryResultFromUnknown(
      { delivered: 0, skipped: 1, staleSkipped: 1 },
      "connection:test:legacy",
    )).toEqual({
      delivered: 0,
      skipped: 1,
      staleSkipped: 1,
      skipReasons: { stale: 1 },
    });
  });

  it("merges staleSkipped into mixed skip reason responses", () => {
    expect(liveQueryDeliveryResultFromUnknown(
      {
        delivered: 0,
        skipped: 2,
        staleSkipped: 1,
        skipReasons: { missingQuery: 1 },
      },
      "connection:test:mixed",
    )).toEqual({
      delivered: 0,
      skipped: 2,
      staleSkipped: 1,
      skipReasons: { missingQuery: 1, stale: 1 },
    });
  });

  it("rejects mismatched staleSkipped and skipReasons.stale counts", () => {
    expect(() =>
      liveQueryDeliveryResultFromUnknown(
        {
          delivered: 0,
          skipped: 2,
          staleSkipped: 1,
          skipReasons: { stale: 2 },
        },
        "connection:test:mismatch",
      )
    ).toThrow(
      "connection:test:mismatch.staleSkipped must match connection:test:mismatch.skipReasons.stale when both are present.",
    );
  });
});
