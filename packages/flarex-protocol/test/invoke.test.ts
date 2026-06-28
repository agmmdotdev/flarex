import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  InvokeProtocolValidationError,
  parsePublicInvokeRequestBody,
  PublicInvokeRequestBodySchema,
} from "../src/invoke";

const decodePublicInvokeRequestBody = Schema.decodeUnknownSync(
  PublicInvokeRequestBodySchema,
);

describe("invoke protocol schemas", () => {
  it("parses public invoke request bodies used by the Worker route", () => {
    expect(parsePublicInvokeRequestBody({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "invoke-once",
    })).toEqual({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "invoke-once",
    });

    expect(decodePublicInvokeRequestBody({
      path: "users:create",
      kind: "mutation",
      args: ["Ada", 1, null],
    })).toEqual({
      path: "users:create",
      kind: "mutation",
      args: ["Ada", 1, null],
    });
  });

  it("allows omitted args so the Worker can keep its null defaulting boundary", () => {
    expect(parsePublicInvokeRequestBody({
      path: "health",
    })).toEqual({
      path: "health",
    });
  });

  it("rejects non-object bodies and invalid invoke field shapes", () => {
    expect(() => parsePublicInvokeRequestBody(null))
      .toThrow(InvokeProtocolValidationError);
    expect(() => parsePublicInvokeRequestBody([]))
      .toThrow("Invoke request body must be an object.");
    expect(() => parsePublicInvokeRequestBody({ kind: "action" }))
      .toThrow("Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.");
    expect(() => parsePublicInvokeRequestBody({ args: undefined }))
      .not
      .toThrow();
    expect(() => parsePublicInvokeRequestBody({ args: () => undefined }))
      .toThrow(InvokeProtocolValidationError);
    expect(() => parsePublicInvokeRequestBody({ args: new Date(0) }))
      .toThrow(InvokeProtocolValidationError);
    expect(() => parsePublicInvokeRequestBody({
      args: { [Symbol("hidden")]: "value" },
    }))
      .toThrow(InvokeProtocolValidationError);
    expect(() => decodePublicInvokeRequestBody({ args: new Date(0) }))
      .toThrow();
    expect(() => decodePublicInvokeRequestBody({ args: Number.NaN }))
      .toThrow();
  });
});
