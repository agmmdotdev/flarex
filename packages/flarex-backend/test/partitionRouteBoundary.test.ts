import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePartitionSchemaCacheRequest,
  readPartitionSchemaCacheRequest,
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
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/schema-cache", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
