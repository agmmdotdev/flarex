import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodePartitionCommitRoutePayload,
  decodePartitionCommitRequest,
  decodePartitionConnectionUnregisterRoutePayload,
  decodePartitionConnectionUnregisterRequest,
  decodePartitionSchemaCacheRoutePayload,
  decodePartitionSchemaCacheRequest,
  decodePartitionSubscriptionRegistrationRoutePayload,
  decodePartitionSubscriptionRegistrationRequest,
  decodePartitionSubscriptionTargetRoutePayload,
  decodePartitionSubscriptionTargetRequest,
  partitionRouteErrorToHttpError,
  partitionRouteErrorToHttpErrorEffect,
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

  it("decodes partition route payloads through named Effect boundaries", async () => {
    await expect(Effect.runPromise(decodePartitionSchemaCacheRoutePayload({
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

    await expect(Effect.runPromise(decodePartitionCommitRoutePayload({
      beginTs: 3,
      writes: [{ tableId: 1, value: { name: "Ada" } }],
    }))).resolves.toEqual({
      beginTs: 3,
      writes: [{ tableId: 1, value: { name: "Ada" } }],
    });

    await expect(Effect.runPromise(decodePartitionCommitRoutePayload({
      beginTs: 1,
      writes: [{ tableId: "1", value: null }],
    }))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "writes[0].tableId must be an integer.",
    });

    await expect(Effect.runPromise(decodePartitionSubscriptionRegistrationRoutePayload({
      connectionName: "connection-a",
      queryId: 7,
      readSet: {
        documents: [{ tableId: 1, id: "1:ada" }],
      },
    }))).resolves.toEqual({
      connectionName: "connection-a",
      queryId: 7,
      readSet: {
        documents: [{ tableId: 1, id: "1:ada" }],
      },
    });

    await expect(Effect.runPromise(decodePartitionSubscriptionTargetRoutePayload({
      connectionName: "connection-a",
      queryId: 7.5,
    }))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "queryId must be an integer.",
    });

    await expect(Effect.runPromise(decodePartitionConnectionUnregisterRoutePayload({
      connectionName: "connection-a",
      ignored: true,
    }))).resolves.toEqual({
      connectionName: "connection-a",
    });
  });

  it("decodes schema-cache requests", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [],
      indexes: [],
    };

    await expect(Effect.runPromise(decodePartitionSchemaCacheRequest(jsonRequest({
      partitionKey: "user:ada",
      schema,
      ignored: true,
    })))).resolves.toEqual({
      partitionKey: "user:ada",
      schema,
      ignored: true,
    });
  });

  it("preserves legacy flat schema-cache request bodies", async () => {
    await expect(Effect.runPromise(decodePartitionSchemaCacheRoutePayload({
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
  });

  it("maps invalid schema-cache envelopes to 400", async () => {
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionSchemaCacheRoutePayload("schema"),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "schema-cache request body must be an object.",
    });
  });

  it("emits typed malformed schema-cache JSON errors", async () => {
    await expect(Effect.runPromise(decodePartitionSchemaCacheRequest(new Request(
      "https://flarex.test/schema-cache",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toMatchObject({
      _tag: "RequestJsonError",
      message: "Request body must be JSON.",
    });
  });

  it("decodes commit requests", async () => {
    await expect(Effect.runPromise(decodePartitionCommitRequest(jsonRequest({
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
    })))).resolves.toEqual({
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

  it("maps invalid commit envelopes to 400", async () => {
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionCommitRoutePayload({
        beginTs: 1,
        writes: [{ tableId: "1", value: null }],
      }),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "writes[0].tableId must be an integer.",
    });
  });

  it("emits typed validation errors from commit Effect parsing", async () => {
    await expect(Effect.runPromise(decodePartitionCommitRoutePayload({
      beginTs: 1,
      writes: [{ tableId: "1", value: null }],
    }))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "writes[0].tableId must be an integer.",
    });
  });

  it("maps partition route validation errors to HttpError", async () => {
    try {
      await Effect.runPromise(decodePartitionCommitRoutePayload({
        beginTs: 1,
        writes: [{ tableId: "1", value: null }],
      }));
      throw new Error("Expected decodePartitionCommitRoutePayload to fail.");
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

  it("maps partition route errors through the named Effect adapter", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("bad json"),
    });
    const validationError = new PartitionRoutePayloadError({
      message: "writes must be an array.",
    });

    await expect(Effect.runPromise(
      partitionRouteErrorToHttpErrorEffect(jsonError),
    )).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    await expect(Effect.runPromise(
      partitionRouteErrorToHttpErrorEffect(validationError),
    )).rejects.toMatchObject({
      status: 400,
      message: "writes must be an array.",
    });
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

  it("maps invalid commit read sets to 400", async () => {
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionCommitRoutePayload({
        beginTs: 1,
        readSet: {
          documents: [{ tableId: 1, id: "" }],
        },
        writes: [],
      }),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "readSet.documents[0].id must be a non-empty string.",
    });
  });

  it("maps invalid commit write values to 400", async () => {
    const value = { invalid: Number.POSITIVE_INFINITY };
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionCommitRoutePayload({
        beginTs: 1,
        writes: [{ tableId: 1, value }],
      }),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "writes[0].value must be a JSON value.",
    });
  });

  it("emits typed malformed commit JSON errors", async () => {
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

    await expect(Effect.runPromise(decodePartitionSubscriptionRegistrationRequest(jsonRequest({
      connectionName: "connection-a",
      queryId: 7,
      readSet,
      ignored: true,
    })))).resolves.toEqual({
      connectionName: "connection-a",
      queryId: 7,
      readSet,
    });
  });

  it("decodes subscription unregister targets", async () => {
    await expect(Effect.runPromise(decodePartitionSubscriptionTargetRoutePayload({
      connectionName: "connection-a",
      queryId: 7,
      ignored: true,
    }))).resolves.toEqual({
      connectionName: "connection-a",
      queryId: 7,
    });
  });

  it("decodes connection unregister requests", async () => {
    await expect(Effect.runPromise(decodePartitionConnectionUnregisterRequest(jsonRequest({
      connectionName: "connection-a",
      ignored: true,
    })))).resolves.toEqual({
      connectionName: "connection-a",
    });
  });

  it("maps invalid subscription registration envelopes to 400", async () => {
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionSubscriptionRegistrationRoutePayload({
        connectionName: "connection-a",
        queryId: 7,
        readSet: null,
      }),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "readSet must be an object.",
    });
  });

  it("maps invalid subscription target envelopes to 400", async () => {
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionSubscriptionTargetRoutePayload({
        connectionName: "connection-a",
        queryId: 7.5,
      }),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "queryId must be an integer.",
    });
  });

  it("maps invalid connection unregister envelopes to 400", async () => {
    const error = await Effect.runPromise(Effect.flip(
      decodePartitionConnectionUnregisterRoutePayload({
        connectionName: "",
      }),
    ));

    expect(partitionRouteErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "connectionName must be a non-empty string.",
    });
  });

  it("emits typed malformed subscription registration JSON errors", async () => {
    await expect(Effect.runPromise(decodePartitionSubscriptionRegistrationRequest(new Request(
      "https://flarex.test/subscriptions/register",
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
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/schema-cache", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
