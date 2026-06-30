import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  decodePartitionCommitRequest,
  partitionRouteErrorToHttpError,
  parsePartitionCommitRequest,
  parsePartitionCommitRequestEffect,
  parsePartitionConnectionUnregisterRequest,
  parsePartitionSchemaCacheRequest,
  parsePartitionSubscriptionRegistrationRequest,
  parsePartitionSubscriptionTargetRequest,
  readPartitionCommitRequest,
  readPartitionConnectionUnregisterRequest,
  readPartitionSchemaCacheRequest,
  readPartitionSubscriptionRegistrationRequest,
} from "../src/partition/RouteBoundary";
import {
  decodePartitionCommitPayload,
  decodePartitionConnectionUnregisterPayload,
  decodePartitionSchemaCachePayload,
  decodePartitionSubscriptionRegistrationPayload,
  decodePartitionSubscriptionTargetPayload,
  PartitionRoutePayloadError,
} from "../src/partition/Requests";
import type { DeploymentSchema } from "../src/types";

describe("partition route boundary", () => {
  it("decodes partition route payloads through shared typed boundaries", async () => {
    await expect(Effect.runPromise(decodePartitionSchemaCachePayload({
      partitionKey: "user:ada",
      version: 1,
      tables: [],
      indexes: [],
    }))).resolves.toEqual({
      partitionKey: "user:ada",
      version: 1,
      tables: [],
      indexes: [],
    });

    await expect(Effect.runPromise(decodePartitionCommitPayload({
      beginTs: 3,
      writes: [{ tableId: 1, value: { name: "Ada" } }],
    }))).resolves.toEqual({
      beginTs: 3,
      writes: [{ tableId: 1, value: { name: "Ada" } }],
    });
  });

  it("decodes schema-cache requests", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [],
      indexes: [],
    };

    await expect(readPartitionSchemaCacheRequest(jsonRequest({
      partitionKey: "user:ada",
      schema,
      ignored: true,
    }))).resolves.toEqual({
      partitionKey: "user:ada",
      schema,
      ignored: true,
    });
  });

  it("preserves legacy flat schema-cache request bodies", () => {
    expect(parsePartitionSchemaCacheRequest({
      partitionKey: "user:ada",
      version: 1,
      tables: [],
      indexes: [],
    })).toEqual({
      partitionKey: "user:ada",
      version: 1,
      tables: [],
      indexes: [],
    });
  });

  it("maps invalid schema-cache envelopes to 400", () => {
    expect(() => parsePartitionSchemaCacheRequest(null))
      .toThrow(HttpError);
    try {
      parsePartitionSchemaCacheRequest("schema");
      throw new Error("Expected parsePartitionSchemaCacheRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "schema-cache request body must be an object.",
      });
    }
  });

  it("preserves malformed schema-cache JSON as the shared JSON body error", async () => {
    await expect(readPartitionSchemaCacheRequest(new Request(
      "https://flarex.test/schema-cache",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes commit requests", async () => {
    await expect(readPartitionCommitRequest(jsonRequest({
      beginTs: 3,
      schemaVersion: 2,
      source: "mutation:test",
      idempotencyKey: "commit-key",
      readSet: {
        documents: [{ tableId: 1, id: "1:ada" }],
        tables: [{ tableId: 2 }],
        indexes: [{ indexId: 3, lower: "a", upper: "z" }],
      },
      writes: [
        { tableId: 1, id: "1:ada", value: { name: "Ada" } },
        { tableId: 1, value: null },
      ],
      ignored: true,
    }))).resolves.toEqual({
      beginTs: 3,
      schemaVersion: 2,
      source: "mutation:test",
      idempotencyKey: "commit-key",
      readSet: {
        documents: [{ tableId: 1, id: "1:ada" }],
        tables: [{ tableId: 2 }],
        indexes: [{ indexId: 3, lower: "a", upper: "z" }],
      },
      writes: [
        { tableId: 1, id: "1:ada", value: { name: "Ada" } },
        { tableId: 1, value: null },
      ],
    });
  });

  it("decodes commit requests through the Effect boundary", async () => {
    await expect(Effect.runPromise(decodePartitionCommitRequest(jsonRequest({
      beginTs: 3,
      writes: [{ tableId: 1, value: { name: "Ada" } }],
    })))).resolves.toEqual({
      beginTs: 3,
      writes: [{ tableId: 1, value: { name: "Ada" } }],
    });
  });

  it("maps invalid commit envelopes to 400", () => {
    expect(() => parsePartitionCommitRequest(null))
      .toThrow(HttpError);
    try {
      parsePartitionCommitRequest({
        beginTs: 1,
        writes: [{ tableId: "1", value: null }],
      });
      throw new Error("Expected parsePartitionCommitRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "writes[0].tableId must be an integer.",
      });
    }
  });

  it("emits typed validation errors from commit Effect parsing", async () => {
    await expect(Effect.runPromise(parsePartitionCommitRequestEffect({
      beginTs: 1,
      writes: [{ tableId: "1", value: null }],
    }))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "writes[0].tableId must be an integer.",
    });
  });

  it("maps partition route validation errors to HttpError", async () => {
    try {
      await Effect.runPromise(parsePartitionCommitRequestEffect({
        beginTs: 1,
        writes: [{ tableId: "1", value: null }],
      }));
      throw new Error("Expected parsePartitionCommitRequestEffect to fail.");
    } catch (error) {
      const httpError = partitionRouteErrorToHttpError(
        error as Parameters<typeof partitionRouteErrorToHttpError>[0],
      );
      expect(httpError).toMatchObject({
        status: 400,
        message: "writes[0].tableId must be an integer.",
      });
    }
  });

  it("exposes shared typed partition payload failures before HTTP mapping", async () => {
    const commitFailure = await Effect.runPromise(Effect.flip(decodePartitionCommitPayload({
      beginTs: 1,
      writes: [{ tableId: "1", value: null }],
    })));

    expect(commitFailure).toBeInstanceOf(PartitionRoutePayloadError);
    expect(commitFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "writes[0].tableId must be an integer.",
    });

    await expect(Effect.runPromise(Effect.flip(decodePartitionSubscriptionRegistrationPayload({
      connectionName: "connection-a",
      queryId: 7,
      readSet: null,
    })))).resolves.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "readSet must be an object.",
    });

    await expect(Effect.runPromise(Effect.flip(decodePartitionSubscriptionTargetPayload({
      connectionName: "connection-a",
      queryId: 7.5,
    })))).resolves.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "queryId must be an integer.",
    });

    await expect(Effect.runPromise(Effect.flip(decodePartitionConnectionUnregisterPayload({
      connectionName: "",
    })))).resolves.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "connectionName must be a non-empty string.",
    });
  });

  it("maps invalid commit read sets to 400", () => {
    try {
      parsePartitionCommitRequest({
        beginTs: 1,
        readSet: {
          documents: [{ tableId: 1, id: "" }],
        },
        writes: [],
      });
      throw new Error("Expected parsePartitionCommitRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "readSet.documents[0].id must be a non-empty string.",
      });
    }
  });

  it("maps invalid commit write values to 400", () => {
    const value = { invalid: Number.POSITIVE_INFINITY };

    try {
      parsePartitionCommitRequest({
        beginTs: 1,
        writes: [{ tableId: 1, value }],
      });
      throw new Error("Expected parsePartitionCommitRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "writes[0].value must be a JSON value.",
      });
    }
  });

  it("preserves malformed commit JSON as the shared JSON body error", async () => {
    await expect(readPartitionCommitRequest(new Request(
      "https://flarex.test/commit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("emits typed JSON errors from commit Effect decoding", async () => {
    await expect(Effect.runPromise(decodePartitionCommitRequest(new Request(
      "https://flarex.test/commit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toMatchObject({
      _tag: "RequestJsonError",
      message: "Request body must be JSON.",
    });
  });

  it("decodes subscription registration requests", async () => {
    const readSet = {
      documents: [{ tableId: 1, id: "1:ada" }],
      indexes: [{ indexId: 2, lower: "a", upper: "z" }],
    };

    await expect(readPartitionSubscriptionRegistrationRequest(jsonRequest({
      connectionName: "connection-a",
      queryId: 7,
      readSet,
      ignored: true,
    }))).resolves.toEqual({
      connectionName: "connection-a",
      queryId: 7,
      readSet,
    });
  });

  it("decodes subscription unregister targets", () => {
    expect(parsePartitionSubscriptionTargetRequest({
      connectionName: "connection-a",
      queryId: 7,
      ignored: true,
    })).toEqual({
      connectionName: "connection-a",
      queryId: 7,
    });
  });

  it("decodes connection unregister requests", async () => {
    await expect(readPartitionConnectionUnregisterRequest(jsonRequest({
      connectionName: "connection-a",
      ignored: true,
    }))).resolves.toEqual({
      connectionName: "connection-a",
    });
  });

  it("maps invalid subscription registration envelopes to 400", () => {
    expect(() => parsePartitionSubscriptionRegistrationRequest(null))
      .toThrow(HttpError);
    try {
      parsePartitionSubscriptionRegistrationRequest({
        connectionName: "connection-a",
        queryId: 7,
        readSet: null,
      });
      throw new Error("Expected parsePartitionSubscriptionRegistrationRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "readSet must be an object.",
      });
    }
  });

  it("maps invalid subscription target envelopes to 400", () => {
    try {
      parsePartitionSubscriptionTargetRequest({
        connectionName: "connection-a",
        queryId: 7.5,
      });
      throw new Error("Expected parsePartitionSubscriptionTargetRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "queryId must be an integer.",
      });
    }
  });

  it("maps invalid connection unregister envelopes to 400", () => {
    try {
      parsePartitionConnectionUnregisterRequest({
        connectionName: "",
      });
      throw new Error("Expected parsePartitionConnectionUnregisterRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "connectionName must be a non-empty string.",
      });
    }
  });

  it("preserves malformed subscription registration JSON as the shared JSON body error", async () => {
    await expect(readPartitionSubscriptionRegistrationRequest(new Request(
      "https://flarex.test/subscriptions/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/schema-cache", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
