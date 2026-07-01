import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicPartitionSchemaCacheRequest,
  decodePublicPartitionSchemaCacheRoutePayload,
  parsePublicPartitionSchemaCacheRequest,
  parsePublicPartitionSchemaCacheRequestEffect,
  publicPartitionSchemaCacheRouteErrorToHttpError,
  publicPartitionSchemaCacheRouteErrorToHttpErrorEffect,
  readPublicPartitionSchemaCacheRequest,
} from "../src/partition/PublicSchemaCacheRouteBoundary";
import {
  decodePublicPartitionSchemaCachePayload,
  PartitionRoutePayloadError,
} from "../src/partition/Requests";
import type { DeploymentSchema } from "../src/types";

describe("public partition schema-cache route boundary", () => {
  it("wraps public schema-cache payloads through the shared source boundary", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [],
      indexes: [],
    };

    await expect(Effect.runPromise(decodePublicPartitionSchemaCachePayload(
      schema,
      "user:ada",
    ))).resolves.toEqual({
      partitionKey: "user:ada",
      schema,
    });
  });

  it("wraps public schema-cache route payloads through a named Effect boundary", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [],
      indexes: [],
    };

    await expect(Effect.runPromise(decodePublicPartitionSchemaCacheRoutePayload(
      schema,
      "user:ada",
    ))).resolves.toEqual({
      partitionKey: "user:ada",
      schema,
    });

    await expect(Effect.runPromise(decodePublicPartitionSchemaCacheRoutePayload(
      "schema",
      "user:ada",
    ))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "schema-cache request body must be an object.",
    });
  });

  it("wraps schema-cache requests with the route partition key", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [],
      indexes: [],
    };

    await expect(readPublicPartitionSchemaCacheRequest(
      jsonRequest({
        ...schema,
        partitionKey: "body-partition",
      }),
      "user:ada",
    )).resolves.toEqual({
      partitionKey: "user:ada",
      schema: {
        ...schema,
        partitionKey: "body-partition",
      },
    });
  });

  it("wraps schema-cache requests through the Effect boundary", async () => {
    const schema: DeploymentSchema = {
      version: 1,
      tables: [],
      indexes: [],
    };

    await expect(Effect.runPromise(decodePublicPartitionSchemaCacheRequest(
      jsonRequest(schema),
      "user:ada",
    ))).resolves.toEqual({
      partitionKey: "user:ada",
      schema,
    });
  });

  it("maps invalid schema-cache envelopes to 400", () => {
    expect(() => parsePublicPartitionSchemaCacheRequest(null, "user:ada"))
      .toThrow(HttpError);
    try {
      parsePublicPartitionSchemaCacheRequest("schema", "user:ada");
      throw new Error("Expected parsePublicPartitionSchemaCacheRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "schema-cache request body must be an object.",
      });
    }
  });

  it("emits typed validation errors from Effect parsing", async () => {
    await expect(Effect.runPromise(parsePublicPartitionSchemaCacheRequestEffect(
      "schema",
      "user:ada",
    ))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "schema-cache request body must be an object.",
    });
  });

  it("maps public schema-cache route errors to HttpError", async () => {
    try {
      await Effect.runPromise(parsePublicPartitionSchemaCacheRequestEffect("schema", "user:ada"));
      throw new Error("Expected parsePublicPartitionSchemaCacheRequestEffect to fail.");
    } catch (error) {
      const httpError = publicPartitionSchemaCacheRouteErrorToHttpError(
        error as Parameters<typeof publicPartitionSchemaCacheRouteErrorToHttpError>[0],
      );
      expect(httpError).toMatchObject({
        status: 400,
        message: "schema-cache request body must be an object.",
      });
    }
  });

  it("maps public schema-cache route errors through the named Effect adapter", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("bad json"),
    });
    const validationError = new PartitionRoutePayloadError({
      message: "schema-cache request body must be an object.",
    });

    await expect(Effect.runPromise(
      publicPartitionSchemaCacheRouteErrorToHttpErrorEffect(jsonError),
    )).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    await expect(Effect.runPromise(
      publicPartitionSchemaCacheRouteErrorToHttpErrorEffect(validationError),
    )).rejects.toMatchObject({
      status: 400,
      message: "schema-cache request body must be an object.",
    });
  });

  it("exposes shared typed public schema-cache payload failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(decodePublicPartitionSchemaCachePayload(
      "schema",
      "user:ada",
    )));

    expect(failure).toBeInstanceOf(PartitionRoutePayloadError);
    expect(failure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "schema-cache request body must be an object.",
    });
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readPublicPartitionSchemaCacheRequest(new Request(
      "https://flarex.test/deployments/deployment-a/partitions/user%3Aada/schema-cache",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), "user:ada")).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("emits typed JSON errors from Effect decoding", async () => {
    await expect(Effect.runPromise(decodePublicPartitionSchemaCacheRequest(new Request(
      "https://flarex.test/deployments/deployment-a/partitions/user%3Aada/schema-cache",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), "user:ada"))).rejects.toMatchObject({
      _tag: "RequestJsonError",
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request(
    "https://flarex.test/deployments/deployment-a/partitions/user%3Aada/schema-cache",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
