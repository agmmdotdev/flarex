import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { executionIdentityFingerprint } from "../src/auth";
import {
  decodeDeliveryWakePayloadEffect,
  decodeLiveQueryDeliveryChangesBodyEffect,
  decodePublicDeliveryWakePayloadEffect,
  DeliveryWakePayloadError,
  DeliveryWakeRequestSchema,
  LiveQueryDeliveryChangePayloadError,
  LiveQueryDeliveryChangesBodySchema,
} from "../src/live-query";

const decodeLiveQueryDeliveryChangesBody = Schema.decodeUnknownSync(
  LiveQueryDeliveryChangesBodySchema,
);
const decodeDeliveryWakeRequest = Schema.decodeUnknownSync(DeliveryWakeRequestSchema);
const anonymousIdentityFingerprint = executionIdentityFingerprint({ kind: "anonymous" });

describe("live query protocol schemas", () => {
  it("decodes backend live-query delivery callback bodies", async () => {
    await expect(Effect.runPromise(decodeLiveQueryDeliveryChangesBodyEffect({
      deliveries: [
        {
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-a",
          queryId: 1,
          functionPath: "users:get",
          argsJson: { id: "1:user" },
          identityFingerprint: anonymousIdentityFingerprint,
          resultJson: { name: "Ada" },
          previousResultHash: "previous",
          resultHash: "result",
        },
        {
          kind: "failed",
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-b",
          queryId: 2,
          functionPath: "users:list",
          argsJson: {},
          identityFingerprint: anonymousIdentityFingerprint,
          previousResultHash: "previous",
          errorMessage: "boom",
          errorData: { code: "QUERY_FAILED" },
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
        identityFingerprint: anonymousIdentityFingerprint,
        resultJson: { name: "Ada" },
        previousResultHash: "previous",
        resultHash: "result",
      },
      {
        kind: "failed",
        deploymentId: "deployment-a",
        connectionId: "connection:deployment-a:session-b",
        queryId: 2,
        functionPath: "users:list",
        argsJson: {},
        identityFingerprint: anonymousIdentityFingerprint,
        previousResultHash: "previous",
        errorMessage: "boom",
        errorData: { code: "QUERY_FAILED" },
      },
    ]);
  });

  it("defaults pre-upgrade delivery payloads to anonymous identity", async () => {
    await expect(Effect.runPromise(decodeLiveQueryDeliveryChangesBodyEffect({
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
    }))).resolves.toMatchObject([
      {
        kind: "updated",
        identityFingerprint: anonymousIdentityFingerprint,
      },
    ]);
  });

  it("keeps live-query delivery decode failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeLiveQueryDeliveryChangesBodyEffect({})))
      .rejects.toMatchObject({
        _tag: "LiveQueryDeliveryChangePayloadError",
        message: "Live query delivery body must be an object with a deliveries array.",
      });

    await expect(Effect.runPromise(decodeLiveQueryDeliveryChangesBodyEffect({
      deliveries: [{ queryId: 1 }],
    }))).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryChangePayloadError",
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });

    await expect(Effect.runPromise(decodeLiveQueryDeliveryChangesBodyEffect({
      deliveries: [
        {
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-a",
          queryId: 1,
          functionPath: "users:get",
          argsJson: Number.NaN,
          identityFingerprint: anonymousIdentityFingerprint,
          resultJson: {},
          previousResultHash: "previous",
          resultHash: "result",
        },
      ],
    }))).rejects.toBeInstanceOf(LiveQueryDeliveryChangePayloadError);
  });

  it("exposes live-query delivery schemas for normalized payloads", () => {
    expect(decodeLiveQueryDeliveryChangesBody({
      deliveries: [{
        kind: "updated",
        deploymentId: "deployment-a",
        connectionId: "connection:deployment-a:session-a",
        queryId: 1,
        functionPath: "users:get",
        argsJson: null,
        identityFingerprint: anonymousIdentityFingerprint,
        resultJson: ["ok"],
        previousResultHash: "previous",
        resultHash: "result",
      }],
    })).toEqual({
      deliveries: [{
        kind: "updated",
        deploymentId: "deployment-a",
        connectionId: "connection:deployment-a:session-a",
        queryId: 1,
        functionPath: "users:get",
        argsJson: null,
        identityFingerprint: anonymousIdentityFingerprint,
        resultJson: ["ok"],
        previousResultHash: "previous",
        resultHash: "result",
      }],
    });
  });

  it("decodes DeliveryDO wake callback payloads", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakePayloadEffect({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
    });

    await expect(Effect.runPromise(decodePublicDeliveryWakePayloadEffect({
      deploymentId: "body-deployment",
      limit: 3,
    }, "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 3,
    });
  });

  it("keeps DeliveryDO wake decode failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakePayloadEffect({ limit: 1 })))
      .rejects.toMatchObject({
        _tag: "DeliveryWakePayloadError",
        message: "deploymentId must be a non-empty string.",
      });

    await expect(Effect.runPromise(decodePublicDeliveryWakePayloadEffect(null, "deployment-a")))
      .rejects.toMatchObject({
        _tag: "DeliveryWakePayloadError",
        message: "Delivery wake request body must be an object.",
      });

    await expect(Effect.runPromise(decodePublicDeliveryWakePayloadEffect({
      limit: 0,
    }, "deployment-a"))).rejects.toBeInstanceOf(DeliveryWakePayloadError);
  });

  it("exposes the DeliveryDO wake schema for normalized payloads", () => {
    expect(decodeDeliveryWakeRequest({
      deploymentId: "deployment-a",
      limit: 1,
      maxBatches: 2,
      leaseDurationMs: 3,
    })).toEqual({
      deploymentId: "deployment-a",
      limit: 1,
      maxBatches: 2,
      leaseDurationMs: 3,
    });
  });
});
