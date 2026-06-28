import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePartitionConnectionUnregisterRequest,
  parsePartitionSchemaCacheRequest,
  parsePartitionSubscriptionRegistrationRequest,
  parsePartitionSubscriptionTargetRequest,
  readPartitionConnectionUnregisterRequest,
  readPartitionSchemaCacheRequest,
  readPartitionSubscriptionRegistrationRequest,
} from "../src/partition/RouteBoundary";
import type { DeploymentSchema } from "../src/types";

describe("partition route boundary", () => {
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
