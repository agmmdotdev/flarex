import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { liveQueryDeliveryResultFromUnknown } from "../src/liveQueryDelivery";
import {
  decodeConnectionLiveQueryDeliveryResponse,
  decodeLiveQueryDeliveryAckResponse,
  decodeLiveQueryDeliveryClaimResponse,
  liveQueryDeliveryResponseErrorToHttpError,
} from "../src/liveQueryDeliveryResponses";

describe("live query delivery result parsing", () => {
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
