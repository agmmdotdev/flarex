import { Effect } from "effect";
import { InvokeProtocolValidationError } from "flarex-protocol/invoke";
import { describe, expect, it } from "vitest";
import {
  decodePublicInvokePayload,
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokeDeploymentError,
  MissingInvokePartitionKeyError,
  MissingInvokePathError,
  parsePublicInvokePayload,
  publicInvokeDeploymentIdEffect,
} from "../src/invoke/Requests";

describe("public invoke request payloads", () => {
  it("decodes public invoke payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodePublicInvokePayload({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "invoke-once",
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "invoke-once",
    });

    expect(parsePublicInvokePayload({
      path: "users:list",
      kind: "query",
    })).toEqual({
      path: "users:list",
      kind: "query",
    });
  });

  it("keeps protocol failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodePublicInvokePayload(null)))
      .rejects.toBeInstanceOf(InvokeProtocolValidationError);

    await expect(Effect.runPromise(decodePublicInvokePayload({
      kind: "action",
    }))).rejects.toBeInstanceOf(InvokeProtocolValidationError);
  });

  it("selects the public invoke deployment id from route before body", async () => {
    await expect(Effect.runPromise(publicInvokeDeploymentIdEffect(
      "route-deployment",
      { deploymentId: "body-deployment" },
    ))).resolves.toBe("route-deployment");

    await expect(Effect.runPromise(publicInvokeDeploymentIdEffect(
      undefined,
      { deploymentId: "body-deployment" },
    ))).resolves.toBe("body-deployment");

    await expect(Effect.runPromise(publicInvokeDeploymentIdEffect(undefined, {})))
      .rejects.toBeInstanceOf(MissingInvokeDeploymentError);
  });

  it("builds backend invoke requests before Worker execution", async () => {
    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      path: "users:list",
      args: [{ active: true }],
      partitionKey: "u1",
      kind: "query",
      idempotencyKey: "invoke-once",
    }))).resolves.toEqual({
      path: "users:list",
      args: [{ active: true }],
      partitionKey: "u1",
      kind: "query",
      idempotencyKey: "invoke-once",
    });

    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      path: "users:list",
    }))).resolves.toEqual({
      path: "users:list",
      args: null,
    });

    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      args: null,
    }))).rejects.toBeInstanceOf(MissingInvokePathError);

    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      path: "users:list",
      partitionKey: "",
    }))).rejects.toBeInstanceOf(MissingInvokePartitionKeyError);
  });
});
