import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreNativeReferenceError, CoreNativeUniqueConflict, CoreTransactionError, isCoreDefinitiveCommitRefusal,
  type CoreError, type CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistenceIndexEntry, type CoreWriteBatch } from "../../src/core/contracts";
import { CoreNativeReferenceSchema } from "../../src/core/nativePolicyTypes";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { initialRegistry } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction } from "../../src/core/transaction";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { coreNativeReferenceInterval, coreNativeReferenceTarget, validateCoreNativeReferences,
  type CoreNativeReferenceSelection, type CorePreparedNativeReferences } from "../../src/core/nativeReferences";

const internal = (n: number) => new Uint8Array(16).fill(n);
const source: CoreTableDefinition = { name: "articles", number: 10001, tabletId: internal(1), namespace: null, state: "active", indexes: [] };
const target: CoreTableDefinition = { name: "authors", number: 10002, tabletId: internal(2), namespace: null, state: "active", indexes: [] };
const index = { name: "by_reference_author", ref: { id: internal(3) }, fields: ["author"] };
const reference = Schema.decodeUnknownSync(CoreNativeReferenceSchema)({
  declaration: { format: "flarex.relation-declaration", version: 1,
    source: { table: "articles", path: [{ kind: "field", name: "author" }], forwardName: "author" },
    target: { table: "authors" }, value: { cardinality: "one", required: false },
    inverse: { cardinality: "many", name: null }, localized: false, onTargetDelete: "restrict" },
  reference: { name: "document-relation/payload/articles/author", sourceKey: "payload",
    source: { table: { namespace: "app", logicalName: "articles" }, field: "author" },
    target: { table: { namespace: "app", logicalName: "authors" }, field: "_id" },
    policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "current" } }, onTargetDelete: "restrict" },
  sourceTable: "articles", targetTable: "authors", field: "author", indexName: index.name,
});
const selection: CoreNativeReferenceSelection = { reference, source, target, index };
const id = (table: CoreTableDefinition, n: number) => Result.getOrThrow(encodeDocumentId(table.number, internal(n)));
const targetId = id(target, 4), sourceId = id(source, 5), secondId = id(source, 6);
const interval = Result.getOrThrow(coreNativeReferenceInterval(selection, targetId));
const key = (value: string) => Result.getOrThrow(encodeIndexKey([targetId], value));
const document = (deleted: boolean): CoreDocumentLogEntry => ({ tableId: target.tabletId, id: internal(4), ts: 2n,
  jsonValue: new Uint8Array(), deleted, prevTs: null });
const entry = (owner: string, deleting = false): CorePersistenceIndexEntry => ({ index: index.ref, key: key(owner),
  mode: "scanComplete", ts: 2n, prev: null,
  value: deleting ? null : { tableId: source.tabletId, documentId: owner === sourceId ? internal(5) : internal(6) } });
const batch = (documents: readonly CoreDocumentLogEntry[] = [], indexes: readonly CorePersistenceIndexEntry[] = []): CoreWriteBatch => ({ documents, indexes });
const demand = (exists: boolean): CorePreparedNativeReferences => ({ reads: [], incoming: [], maxIdentities: 16,
  demands: [{ selection, sourceId, targetId, targetInternalId: internal(4), exists }] });
const incoming = (...owners: readonly string[]): CorePreparedNativeReferences => ({ reads: [], demands: [], maxIdentities: 16,
  incoming: [{ selection, targetId, interval, entries: new Map(owners.map(owner => [encodeBytesToLowercaseHex(key(owner)), owner])) }] });
const failure = (result: ReturnType<typeof validateCoreNativeReferences>) => Result.isFailure(result) ? result.failure : undefined;

describe("native optional-one final-state integrity", () => {
  it("refuses wrong-table selector and loader IDs before importing a body observation", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const compiled = yield* compilePayloadCollections([
        { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
        { slug: "articles", fields: [{ name: "title", type: "text", required: true },
          { name: "author", type: "relationship", relationTo: "authors" }] },
      ]);
      const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
        scopeUuid: "8f5545a4-cd38-4ae0-a421-12fe85dcb727", epochUuid: "1e8aa599-efb5-45da-9b24-8e48f115f250" });
      const schemaId = yield* Effect.fromResult(encodeDocumentId(532, internal(7)));
      const tables: readonly CoreTableDefinition[] = [source, target].map((table, position) => ({ ...table,
        indexes: [{ name: "by_id", fields: [], ref: { id: internal(30 + position) } }, ...(table.name === "articles" ? [index] : [])],
        nativePolicy: { state: "active", schemaId, identity: definition.identity, applicationRead: definition.applicationRead,
          uniqueConstraints: [], references: definition.references } }));
      const registry = yield* Effect.fromResult(initialRegistry(tables));
      let captures = 0;
      const unavailable = new CoreTransactionError({ reason: "unavailable" });
      const internals = createCoreTransaction({ registry, snapshot: { timestamp: 1n,
        get: () => Effect.succeed(Option.none()), scan: () => Effect.succeed({ entries: [], cursor: { kind: "end" } }) },
        now: 1_000_000_000n, vault: new CoreFinalizationVault(),
        idGenerator: yield* Effect.fromResult(createTransactionIdGenerator(new Uint8Array(32), 1_000_000_000n)),
        native: { authority: { definition, namespace: null, schemaId, authorityEpoch: 0n, tables }, visibility: "command",
          limits: { maxIdentities: 16, maxDocumentBytes: 65_536 }, chargeRetained: () => Effect.void,
          capture: () => Effect.suspend(() => { captures += 1; return Effect.fail(unavailable); }) } });
      const operations = internals.nativeOperations;
      if (operations === undefined) return yield* Effect.die(new Error("Missing native test operations"));
      try {
        const attempts: readonly Effect.Effect<unknown, CoreError>[] = [operations.find("articles", { _id: targetId }), operations.find("articles", { _id: "malformed" }),
          operations.getMany("authors", [sourceId]), operations.getMany("authors", [targetId, sourceId]),
          operations.getMany("authors", ["malformed"]), operations.incomingReferences("author", sourceId, { limit: 1 }),
          operations.incomingReferences("author", "malformed", { limit: 1 })];
        for (const attempt of attempts) {
          expect(yield* Effect.flip(attempt)).toMatchObject({ reason: "invalidDocumentId" });
        }
        expect(yield* Effect.flip(operations.getMany("articles", [sourceId]))).toMatchObject({ reason: "authorityRevoked" });
        expect(captures).toBe(0);
        // A correctly typed ID continues to its ordinary snapshot read owner.
        expect(yield* Effect.flip(operations.find("articles", { _id: sourceId }))).toBe(unavailable);
        expect(captures).toBe(1);
      } finally { yield* internals.transaction.abort(); }
    }));
  });

  it("classifies only the three definitive commit-refusal owners", () => {
    expect(isCoreDefinitiveCommitRefusal(new CoreTransactionError({ reason: "conflict" }))).toBe(true);
    expect(isCoreDefinitiveCommitRefusal(new CoreNativeUniqueConflict({ tableName: "articles", descriptor: "title", fields: ["title"] }))).toBe(true);
    expect(isCoreDefinitiveCommitRefusal(new CoreNativeReferenceError({ reason: "relationTargetMissing", forwardName: "author",
      sourceTable: "articles", targetTable: "authors", sourceId, targetId }))).toBe(true);
    expect(isCoreDefinitiveCommitRefusal(new CorePersistenceError({ reason: "uncertainWrite" }))).toBe(false);
    expect(isCoreDefinitiveCommitRefusal(new CorePersistenceError({ reason: "unavailable" }))).toBe(false);
  });

  it("validates table-typed IDs separately from target liveness", () => {
    expect(Result.getOrThrow(coreNativeReferenceTarget(selection, { author: targetId }))).toBe(targetId);
    expect(Result.getOrThrow(coreNativeReferenceTarget(selection, {}))).toBe(null);
    expect(Result.getOrThrow(coreNativeReferenceTarget(selection, { author: null }))).toBe(null);
    expect(Result.isFailure(coreNativeReferenceTarget(selection, { author: sourceId }))).toBe(true);
  });

  it("preserves the late missing-target error and does not depend on unrelated target bodies", () => {
    const bodyUpdate = batch([document(false)]);
    expect([...Result.getOrThrow(validateCoreNativeReferences(demand(true), [bodyUpdate], batch()))]).toEqual([]);
    expect(failure(validateCoreNativeReferences(demand(true), [batch([document(true)])], batch())))
      .toMatchObject({ reason: "relationTargetMissing", sourceId, targetId });
  });

  it("uses the full accepted target prefix and candidate overlay with actual liveness predecessors", () => {
    const inserted = batch([document(false)]), updated = batch([document(false)]), deleted = batch([document(true)]);
    expect([...Result.getOrThrow(validateCoreNativeReferences(demand(false), [inserted, updated], batch()))]).toEqual([inserted]);
    expect(failure(validateCoreNativeReferences(demand(false), [inserted, deleted], batch())))
      .toMatchObject({ reason: "relationTargetMissing" });
    expect([...Result.getOrThrow(validateCoreNativeReferences(demand(false), [], inserted))]).toEqual([]);
  });

  it("continues beyond a suppressed first incoming source and retains the second violation", () => {
    expect(failure(validateCoreNativeReferences(incoming(sourceId, secondId), [], batch([], [entry(sourceId, true)]))))
      .toMatchObject({ reason: "relationDeleteRestricted", sourceId: secondId });
    expect(Result.isSuccess(validateCoreNativeReferences(incoming(sourceId, secondId), [],
      batch([], [entry(sourceId, true), entry(secondId, true)])))).toBe(true);
  });

  it("folds every incoming predecessor before final restrict and candidate removals", () => {
    const addition = batch([], [entry(sourceId)]), removal = batch([], [entry(sourceId, true)]);
    expect(failure(validateCoreNativeReferences(incoming(), [addition], batch())))
      .toMatchObject({ reason: "relationDeleteRestricted" });
    expect([...Result.getOrThrow(validateCoreNativeReferences(incoming(sourceId), [removal], batch()))]).toEqual([removal]);
    expect(Result.isSuccess(validateCoreNativeReferences(incoming(), [addition, removal], batch()))).toBe(true);
    expect([...Result.getOrThrow(validateCoreNativeReferences(incoming(sourceId), [removal], removal))]).toEqual([]);
  });

  it("checks each integrity slot against the entire accepted iterable", () => {
    const state = { ...incoming(), ...demand(true), incoming: incoming().incoming };
    function* accepted() { yield batch([], [entry(sourceId)]); }
    expect(failure(validateCoreNativeReferences(state, accepted(), batch())))
      .toMatchObject({ reason: "relationDeleteRestricted" });
  });

  it("fails closed when accepted incoming state exceeds its bound", () => {
    const state = { ...incoming(), maxIdentities: 1 };
    expect(failure(validateCoreNativeReferences(state, [batch([], [entry(sourceId), entry(secondId)])], batch())))
      .toMatchObject({ reason: "capacity" });
  });
});
