import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePartitionCommitPayloadEffect,
  decodePartitionConnectionUnregisterPayloadEffect,
  decodePartitionSchemaCachePayloadEffect,
  decodePartitionSubscriptionRegistrationPayloadEffect,
  decodePartitionSubscriptionTargetPayloadEffect,
  decodePublicPartitionSchemaCachePayloadEffect,
  PartitionRoutePayloadError,
} from "../src/partition";

describe("partition protocol payload decoders", () => {
  it("decodes schema-cache payloads", async () => {
    await expect(Effect.runPromise(decodePartitionSchemaCachePayloadEffect({
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

    await expect(Effect.runPromise(decodePublicPartitionSchemaCachePayloadEffect({
      version: 1,
      tables: [],
      indexes: [],
    }, "user:ada"))).resolves.toEqual({
      partitionKey: "user:ada",
      schema: {
        version: 1,
        tables: [],
        indexes: [],
      },
    });
  });

  it("decodes commit payloads", async () => {
    await expect(Effect.runPromise(decodePartitionCommitPayloadEffect({
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

  it("decodes subscription and unregister payloads", async () => {
    await expect(Effect.runPromise(decodePartitionSubscriptionRegistrationPayloadEffect({
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

    await expect(Effect.runPromise(decodePartitionSubscriptionTargetPayloadEffect({
      connectionName: "connection-a",
      queryId: 7,
    }))).resolves.toEqual({
      connectionName: "connection-a",
      queryId: 7,
    });

    await expect(Effect.runPromise(decodePartitionConnectionUnregisterPayloadEffect({
      connectionName: "connection-a",
      ignored: true,
    }))).resolves.toEqual({
      connectionName: "connection-a",
    });
  });

  it("keeps partition failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePartitionSchemaCachePayloadEffect("schema")))
      .rejects.toMatchObject({
        _tag: "PartitionRoutePayloadError",
        message: "schema-cache request body must be an object.",
      });

    await expect(Effect.runPromise(decodePartitionCommitPayloadEffect({
      beginTs: 1,
      writes: [{ tableId: "1", value: null }],
    }))).rejects.toBeInstanceOf(PartitionRoutePayloadError);

    await expect(Effect.runPromise(decodePartitionSubscriptionRegistrationPayloadEffect({
      connectionName: "connection-a",
      queryId: 7,
      readSet: null,
    }))).rejects.toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "readSet must be an object.",
    });
  });
});
