import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePartitionStorageCommitResponseJson,
  decodePartitionStorageCommittedWritesJson,
  decodePartitionStorageDocumentJson,
  decodePartitionStorageIndexFieldsJson,
  decodePartitionStorageIndexWritesJson,
  decodePartitionStorageReadSetJson,
  decodePartitionStorageTablePlacementJson,
  decodePartitionStorageTableValidatorJson,
  PartitionStorageJsonError,
} from "../src/partition/StorageRows";

describe("PartitionDO storage row decoders", () => {
  it("decodes read sets and write log rows through typed Effect schemas", async () => {
    await expect(Effect.runPromise(decodePartitionStorageReadSetJson(JSON.stringify({
      documents: [{ tableId: 1, id: "1:ada" }],
      tables: [{ tableId: 2 }],
      indexes: [{ indexId: 3, lower: "a", upper: "z" }],
    })))).resolves.toEqual({
      documents: [{ tableId: 1, id: "1:ada" }],
      tables: [{ tableId: 2 }],
      indexes: [{ indexId: 3, lower: "a", upper: "z" }],
    });

    await expect(Effect.runPromise(decodePartitionStorageCommittedWritesJson(JSON.stringify([{
      tableId: 1,
      id: "1:ada",
      prevTs: null,
      ts: 4,
      value: { name: "Ada" },
    }])))).resolves.toEqual([{
      tableId: 1,
      id: "1:ada",
      prevTs: null,
      ts: 4,
      value: { name: "Ada" },
    }]);

    await expect(Effect.runPromise(decodePartitionStorageIndexWritesJson(JSON.stringify([{
      indexId: 9,
      key: "Ada\u00001:ada",
      documentId: "1:ada",
      deleted: false,
    }])))).resolves.toEqual([{
      indexId: 9,
      key: "Ada\u00001:ada",
      documentId: "1:ada",
      deleted: false,
    }]);
  });

  it("decodes commit responses, document values, table placement, validators, and index fields", async () => {
    await expect(Effect.runPromise(decodePartitionStorageCommitResponseJson(JSON.stringify({
      committedTs: 7,
      writes: [{
        tableId: 1,
        id: "1:ada",
        prevTs: 6,
        ts: 7,
        value: null,
      }],
    })))).resolves.toEqual({
      committedTs: 7,
      writes: [{
        tableId: 1,
        id: "1:ada",
        prevTs: 6,
        ts: 7,
        value: null,
      }],
    });

    await expect(Effect.runPromise(decodePartitionStorageDocumentJson(JSON.stringify({
      name: "Ada",
      tags: ["math", "logic"],
    })))).resolves.toEqual({
      name: "Ada",
      tags: ["math", "logic"],
    });

    await expect(Effect.runPromise(decodePartitionStorageTablePlacementJson(JSON.stringify({
      kind: "partitionBy",
      field: "userId",
    })))).resolves.toEqual({
      kind: "partitionBy",
      field: "userId",
    });

    await expect(Effect.runPromise(decodePartitionStorageTableValidatorJson(JSON.stringify({
      type: "object",
      value: {
        name: {
          fieldType: { type: "string", ignored: true },
          optional: false,
          ignored: true,
        },
      },
      ignored: true,
    })))).resolves.toEqual({
      type: "object",
      value: {
        name: {
          fieldType: { type: "string" },
          optional: false,
        },
      },
    });

    await expect(Effect.runPromise(decodePartitionStorageIndexFieldsJson(JSON.stringify([
      "name",
      "email",
    ])))).resolves.toEqual(["name", "email"]);
  });

  it("fails with typed storage errors for malformed or schema-invalid row JSON", async () => {
    const malformedError = await Effect.runPromise(
      Effect.flip(decodePartitionStorageReadSetJson("{")),
    );
    expect(malformedError).toBeInstanceOf(PartitionStorageJsonError);
    expect(malformedError.cause).not.toBeInstanceOf(PartitionStorageJsonError);

    await expect(Effect.runPromise(
      decodePartitionStorageCommittedWritesJson(JSON.stringify([{
        tableId: 1,
        id: "1:ada",
        prevTs: null,
        ts: 4,
        value: undefined,
      }])),
    )).rejects.toBeInstanceOf(PartitionStorageJsonError);

    await expect(Effect.runPromise(
      decodePartitionStorageIndexFieldsJson(JSON.stringify(["name", 123])),
    )).rejects.toBeInstanceOf(PartitionStorageJsonError);

    await expect(Effect.runPromise(
      decodePartitionStorageTableValidatorJson(JSON.stringify({
        type: "id",
        tableName: "",
      })),
    )).rejects.toBeInstanceOf(PartitionStorageJsonError);
  });
});
