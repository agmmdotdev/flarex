import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { LiveQueryDeliveryChangePayloadError } from "../src/live-query";
import {
  ConnectionClientMessageError,
  ConnectionInvalidationRequestSchema,
  ConnectionRouteValidationError,
  decodeConnectionClientMessageEffect,
  decodeConnectionClientMessagePayloadEffect,
  decodeConnectionInvalidationPayloadEffect,
  decodeConnectionLiveQueryDeliveryPayloadEffect,
} from "../src/connection";

const decodeConnectionInvalidationRequest = Schema.decodeUnknownSync(
  ConnectionInvalidationRequestSchema,
);

describe("connection protocol schemas", () => {
  it("decodes websocket client messages", async () => {
    await expect(Effect.runPromise(decodeConnectionClientMessageEffect(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [{
        type: "Add",
        queryId: 1,
        udfPath: "users:get",
        args: [{ id: "1:user" }],
        journal: null,
        partitionKey: "user-1",
      }],
    })))).resolves.toEqual({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [{
        type: "Add",
        queryId: 1,
        udfPath: "users:get",
        args: [{ id: "1:user" }],
        journal: null,
        partitionKey: "user-1",
      }],
    });
  });

  it("keeps websocket client message failures typed", async () => {
    await expect(Effect.runPromise(decodeConnectionClientMessageEffect(new ArrayBuffer(0))))
      .rejects.toMatchObject({
        _tag: "ConnectionClientMessageError",
        message: "Binary sync messages are not supported.",
      });

    await expect(Effect.runPromise(decodeConnectionClientMessageEffect("{")))
      .rejects.toBeInstanceOf(ConnectionClientMessageError);

    await expect(Effect.runPromise(decodeConnectionClientMessagePayloadEffect({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: "invalid",
    }))).rejects.toMatchObject({
      _tag: "ConnectionClientMessageError",
      message: "ModifyQuerySet.modifications must be an array.",
    });
  });

  it("decodes invalidation route bodies", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationPayloadEffect({
      queryId: 42,
    }))).resolves.toBe(42);
  });

  it("keeps invalidation route failures typed", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationPayloadEffect({
      queryId: "42",
    }))).rejects.toBeInstanceOf(ConnectionRouteValidationError);

    await expect(Effect.runPromise(decodeConnectionInvalidationPayloadEffect(null)))
      .rejects.toMatchObject({
        _tag: "ConnectionRouteValidationError",
        message: "Invalidation queryId must be an integer.",
      });
  });

  it("decodes connection live-query delivery route bodies", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryPayloadEffect({
      deliveries: [liveQueryDeliveryChange()],
    }))).resolves.toEqual([liveQueryDeliveryChange()]);
  });

  it("keeps connection live-query delivery failures typed", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryPayloadEffect({
      deliveries: [{ queryId: 1 }],
    }))).rejects.toBeInstanceOf(LiveQueryDeliveryChangePayloadError);
  });

  it("exposes connection schemas for normalized payloads", () => {
    expect(decodeConnectionInvalidationRequest({ queryId: 7 })).toEqual({
      queryId: 7,
    });
  });
});

function liveQueryDeliveryChange() {
  return {
    kind: "updated",
    deploymentId: "deployment-a",
    connectionId: "connection:deployment-a:session-a",
    queryId: 1,
    functionPath: "users:get",
    argsJson: { id: "1:user" },
    resultJson: { name: "Ada" },
    previousResultHash: "previous",
    resultHash: "result",
  };
}
