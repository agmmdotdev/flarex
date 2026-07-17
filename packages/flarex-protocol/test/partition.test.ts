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

  it("stops constructing later decoder steps after the first failure", async () => {
    let schemaVersionReads = 0;
    const commitFailure = await Effect.runPromise(Effect.flip(
      decodePartitionCommitPayloadEffect({
        beginTs: "invalid",
        get schemaVersion() {
          schemaVersionReads += 1;
          return 1;
        },
        writes: [],
      }),
    ));
    expect(commitFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "beginTs must be an integer.",
    });
    expect(schemaVersionReads).toBe(0);

    let queryIdReads = 0;
    let registrationReadSetReads = 0;
    const registrationFailure = await Effect.runPromise(Effect.flip(
      decodePartitionSubscriptionRegistrationPayloadEffect({
        connectionName: "",
        get queryId() {
          queryIdReads += 1;
          return 1;
        },
        get readSet() {
          registrationReadSetReads += 1;
          return {};
        },
      }),
    ));
    expect(registrationFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "connectionName must be a non-empty string.",
    });
    expect(queryIdReads).toBe(0);
    expect(registrationReadSetReads).toBe(0);

    let tableReads = 0;
    const readSetFailure = await Effect.runPromise(Effect.flip(
      decodePartitionCommitPayloadEffect({
        beginTs: 1,
        readSet: {
          documents: "invalid",
          get tables() {
            tableReads += 1;
            return [];
          },
        },
        writes: [],
      }),
    ));
    expect(readSetFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "readSet.documents must be an array.",
    });
    expect(tableReads).toBe(0);

    let documentIdReads = 0;
    const documentFailure = await Effect.runPromise(Effect.flip(
      decodePartitionCommitPayloadEffect({
        beginTs: 1,
        readSet: {
          documents: [{
            tableId: "invalid",
            get id() {
              documentIdReads += 1;
              return "1:ada";
            },
          }],
        },
        writes: [],
      }),
    ));
    expect(documentFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "readSet.documents[0].tableId must be an integer.",
    });
    expect(documentIdReads).toBe(0);

    let indexLowerReads = 0;
    const indexFailure = await Effect.runPromise(Effect.flip(
      decodePartitionCommitPayloadEffect({
        beginTs: 1,
        readSet: {
          indexes: [{
            indexId: "invalid",
            get lower() {
              indexLowerReads += 1;
              return "a";
            },
          }],
        },
        writes: [],
      }),
    ));
    expect(indexFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "readSet.indexes[0].indexId must be an integer.",
    });
    expect(indexLowerReads).toBe(0);

    let writeIdReads = 0;
    let writeValueReads = 0;
    const writeFailure = await Effect.runPromise(Effect.flip(
      decodePartitionCommitPayloadEffect({
        beginTs: 1,
        writes: [{
          tableId: "invalid",
          get id() {
            writeIdReads += 1;
            return "1:ada";
          },
          get value() {
            writeValueReads += 1;
            return null;
          },
        }],
      }),
    ));
    expect(writeFailure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "writes[0].tableId must be an integer.",
    });
    expect(writeIdReads).toBe(0);
    expect(writeValueReads).toBe(0);
  });

  it("reads each required string once before validating it", async () => {
    let successReads = 0;
    await expect(Effect.runPromise(decodePartitionConnectionUnregisterPayloadEffect({
      get connectionName() {
        successReads += 1;
        if (successReads > 1) throw new Error("connectionName was read twice");
        return "connection-a";
      },
    }))).resolves.toEqual({ connectionName: "connection-a" });
    expect(successReads).toBe(1);

    let failureReads = 0;
    const failure = await Effect.runPromise(Effect.flip(
      decodePartitionConnectionUnregisterPayloadEffect({
        get connectionName() {
          failureReads += 1;
          return failureReads === 1 ? 1 : "connection-a";
        },
      }),
    ));
    expect(failure).toMatchObject({
      _tag: "PartitionRoutePayloadError",
      message: "connectionName must be a non-empty string.",
    });
    expect(failureReads).toBe(1);
  });
});
