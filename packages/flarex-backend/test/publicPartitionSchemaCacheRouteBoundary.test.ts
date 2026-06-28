import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePublicPartitionSchemaCacheRequest,
  readPublicPartitionSchemaCacheRequest,
} from "../src/partition/PublicSchemaCacheRouteBoundary";
import type { DeploymentSchema } from "../src/types";

describe("public partition schema-cache route boundary", () => {
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
