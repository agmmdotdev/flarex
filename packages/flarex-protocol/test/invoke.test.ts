import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import {
  decodePublicInvokeRequestBodyEffect,
  InvokeResponseSchema,
  InvokeProtocolValidationError,
  parsePublicInvokeRequestBody,
  PublicInvokeRequestBodySchema,
} from "../src/invoke";

const decodePublicInvokeRequestBody = Schema.decodeUnknownSync(
  PublicInvokeRequestBodySchema,
);
const decodeInvokeResponse = Schema.decodeUnknownSync(InvokeResponseSchema);

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

  it("exposes typed invoke request decode failures before compatibility parsing", async () => {
    await expect(Effect.runPromise(decodePublicInvokeRequestBodyEffect({
      kind: "action",
    }))).rejects.toBeInstanceOf(InvokeProtocolValidationError);

    await expect(Effect.runPromise(decodePublicInvokeRequestBodyEffect(null)))
      .rejects.toMatchObject({
        schema: "PublicInvokeRequestBody",
        message: "Invoke request body must be an object.",
      });

    await expect(Effect.runPromise(decodePublicInvokeRequestBodyEffect({
      path: "users:get",
      args: { [Symbol("hidden")]: "value" },
    }))).rejects.toMatchObject({
      schema: "PublicInvokeRequestBody",
      message:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
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

  it("decodes invoke responses returned by execution runtimes", () => {
    expect(decodeInvokeResponse({
      value: { ok: true },
      readSet: {
        documents: [{ tableId: 1, id: "1:user" }],
        tables: [{ tableId: 2 }],
        indexes: [{ indexId: 3, lower: "a", upper: "z" }],
      },
      readTs: 42,
    })).toEqual({
      value: { ok: true },
      readSet: {
        documents: [{ tableId: 1, id: "1:user" }],
        tables: [{ tableId: 2 }],
        indexes: [{ indexId: 3, lower: "a", upper: "z" }],
      },
      readTs: 42,
    });

    expect(decodeInvokeResponse({
      value: null,
      committedTs: 43,
      writes: [{
        tableId: 1,
        id: "1:user",
        prevTs: null,
        ts: 43,
        value: { name: "Ada" },
      }],
    })).toEqual({
      value: null,
      committedTs: 43,
      writes: [{
        tableId: 1,
        id: "1:user",
        prevTs: null,
        ts: 43,
        value: { name: "Ada" },
      }],
    });
  });

  it("rejects invalid invoke response payloads", () => {
    expect(() => decodeInvokeResponse({ readTs: 1 }))
      .toThrow();
    expect(() => decodeInvokeResponse({
      value: () => undefined,
    })).toThrow();
    expect(() => decodeInvokeResponse({
      value: null,
      writes: [{ tableId: 1, id: "1:user", prevTs: null, ts: 1 }],
    })).toThrow();
  });
});
