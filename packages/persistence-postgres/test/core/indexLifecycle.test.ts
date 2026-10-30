import { Deferred, Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import type { CoreTableDefinition } from "../../src/core/api";
import { initialRegistry, tableDocument } from "../../src/core/registry";
import { CoreIndexRegistry } from "../../src/core/indexRegistry";
import { coreIndexMetadataValue, coreIndexWriteMode, decodeCoreIndexMetadata, type CoreIndexRecord } from "../../src/core/indexState";
import { finishCoreIndexChanges, planCoreIndexes, prepareCoreIndexChanges } from "../../src/core/indexModel";
import { advanceCoreIndexBackfillProgress, writeCoreIndexBackfillChunks } from "../../src/core/indexBackfill";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import { classifyCoreQueryFailure } from "../../src/database/corePersistence/driver";

const id = (n: number) => { const value = new Uint8Array(16); value[15] = n; return value; };
const table: CoreTableDefinition = { name: "items", number: 10001, tabletId: id(1), namespace: null, state: "active",
  indexes: [{ name: "by_id", fields: [], ref: { id: id(2) } }, { name: "by_name", fields: ["name"], ref: { id: id(3) } }] };
const pending: CoreIndexRecord = { name: "by_name", fields: ["other"], tableId: id(1), ref: { id: id(4) }, ts: 11n,
  state: { type: "Backfilling", backfillState: { indexCreatedLowerBound: 10n, retentionStarted: false, staged: false } } };

describe("source database index lifecycle", () => {
  it("selects enabled reads and maintains enabled plus pending identities", () => {
    const registry = Result.getOrThrow(Result.flatMap(initialRegistry([table]), registry => registry.withIndex(pending)));
    expect(registry.table("items")?.definition.indexes.map(index => index.ref.id[15])).toEqual([2, 3]);
    expect(registry.indexesForTablet(id(1)).map(index => index.ref.id[15])).toEqual([2, 3, 4]);
    expect(coreIndexWriteMode(pending)).toBe("scanning");
    expect(coreIndexWriteMode({ state: { ...pending.state, type: "Backfilling", backfillState: {
      indexCreatedLowerBound: 10n, retentionStarted: true, staged: false } } })).toBe("scanComplete");
    const duplicate = registry.indexes.apply({ removed: [], added: [{ ...pending, ref: { id: id(5) } }] });
    expect(Result.isFailure(duplicate)).toBe(true);
    expect(Result.isSuccess(registry.indexes.apply({ removed: [id(4)], added: [{ ...pending, ref: { id: id(5) } }] }))).toBe(true);
    expect(Result.isFailure(CoreIndexRegistry.empty().apply({ removed: [], added: [{ ...pending, name: "by_id" }] }))).toBe(true);
  });

  it("retains the readable index until replacement backfill is complete and recomputes activation", () => {
    const initial = Result.getOrThrow(initialRegistry([table]));
    const schema = Result.getOrThrow(captureCoreSchema({ tables: [{ tableName: "items", indexes: [{ indexDescriptor: "by_name", fields: ["other"] }], stagedDbIndexes: [] }], schemaValidation: false }));
    const plan = planCoreIndexes(initial, null, schema);
    expect(plan.added).toHaveLength(1);
    const prepared = prepareCoreIndexChanges(plan, [pending]);
    expect(prepared.removed).toHaveLength(0);
    const preparing = initial.withIndexes(Result.getOrThrow(initial.indexes.apply(prepared)));
    const finishing = planCoreIndexes(preparing, null, schema);
    expect(Result.isFailure(finishCoreIndexChanges(finishing))).toBe(true);
    const backfilled = Result.getOrThrow(preparing.withIndex({ ...pending, state: { type: "Backfilled2", staged: false } }));
    const activation = Result.getOrThrow(finishCoreIndexChanges(planCoreIndexes(backfilled, null, schema)));
    const active = backfilled.withIndexes(Result.getOrThrow(backfilled.indexes.apply(activation)));
    expect(active.table("items")?.definition.indexes.find(index => index.name === "by_name")?.ref.id).toEqual(id(4));
    expect(active.indexById(id(3))).toBeUndefined();
    const reverted = planCoreIndexes(preparing, null, Result.getOrThrow(captureCoreSchema({ ...schema, tables: [{ ...schema.tables[0], tableName: "items", stagedDbIndexes: [],
      indexes: [{ indexDescriptor: "by_name", fields: ["name"] }] }] })));
    expect(reverted.dropped.map(index => index.ref.id)).toEqual([id(4)]);
  });

  it("preserves count-unknown checkpoint branch and source physical metadata", () => {
    const metadata = { indexId: Result.getOrThrow(encodeDocumentId(514, id(4))), numDocsIndexed: 0n, totalDocs: null,
      cursor: { snapshotTs: 10n, cursor: null } };
    const cursor = Result.getOrThrow(encodeDocumentId(10001, id(7)));
    expect(Result.getOrThrow(advanceCoreIndexBackfillProgress(metadata, 3n, cursor, null))).toBe(metadata);
    expect(Result.getOrThrow(advanceCoreIndexBackfillProgress(metadata, 3n, cursor, 20n))).toMatchObject({ numDocsIndexed: 3n,
      totalDocs: 20n, cursor: { snapshotTs: 10n, cursor } });
    expect(tableDocument(table)).toEqual({ name: "items", number: 10001n, state: "active" });
    for (const persistenceIndexId of [0n, -1n, 0x1_0000_0000n]) {
      expect(Result.getOrThrow(decodeCoreIndexMetadata(coreIndexMetadataValue({ ...pending,
        ref: { ...pending.ref, persistenceIndexId } }))).config.persistenceIndexId).toBeUndefined();
    }
    expect(Result.getOrThrow(decodeCoreIndexMetadata(coreIndexMetadataValue({ ...pending,
      ref: { ...pending.ref, persistenceIndexId: 1n } }))).config.persistenceIndexId).toBe(1n);
    expect(Result.isFailure(decodeCoreIndexMetadata({ ...coreIndexMetadataValue(pending), descriptor: "_" }))).toBe(true);
  });

  it("retries only the narrowly settled statement timeout analogue", () => {
    expect(classifyCoreQueryFailure({ code: "57014", message: "canceling statement due to statement timeout" }).reason).toBe("timeout");
    for (const cause of [{ code: "57014", message: "canceling statement due to user request" },
      { code: "57014", message: "localized timeout" }, { code: "08006", message: "connection lost" }])
      expect(classifyCoreQueryFailure(cause).reason).toBe("unavailable");
  });

  it("checkpoints parallel physical chunks in input order after every earlier chunk confirms", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const releaseFirst = yield* Deferred.make<void>();
      const secondFinished = yield* Deferred.make<void>();
      const checkpoints: number[] = [];
      const documents = [10, 11].map(n => ({ ts: BigInt(n), tableId: table.tabletId, id: id(n), deleted: false, prevTs: null,
        jsonValue: Result.getOrThrow(encodeDocumentValue({ _id: Result.getOrThrow(encodeDocumentId(table.number, id(n))), _creationTime: 1, name: String(n) })) }));
      const running = yield* Effect.forkChild(writeCoreIndexBackfillChunks({ table, indexes: [pending], documents,
        lease: { token: 1n }, chunkDocuments: 1, concurrency: 2,
        persistence: { writeIndexBackfill: (_, entries) => entries[0]?.value?.documentId[15] === 10
          ? Deferred.await(releaseFirst) : Deferred.succeed(secondFinished, undefined).pipe(Effect.asVoid) },
        checkpoint: chunk => Effect.sync(() => { checkpoints.push(chunk[0]?.id[15] ?? -1); }),
      }));
      yield* Deferred.await(secondFinished);
      expect(checkpoints).toEqual([]);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(running);
      expect(checkpoints).toEqual([10, 11]);
    }));
  });
});
