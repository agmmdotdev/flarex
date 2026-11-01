import { describe, expect, it } from "vitest";
import { Effect, Option, Result } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreNativeLimits, CoreTableDefinition } from "../../src/core/api";
import type { CorePersistenceIndexEntry, CoreWriteBatch } from "../../src/core/contracts";
import { coreNativeKeyTuple, validateCoreNativeForeignKeys, type CorePreparedNativeForeignKeys } from "../../src/core/nativeForeignKeys";
import { makeCoreNativeDefinition, type CoreNativeForeignKey } from "../../src/core/nativePolicy";
import { CoreRegistry } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction, prepareCoreTransactionIds } from "../../src/core/transaction";
import { CoreWriteLog } from "../../src/core/writeLog";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";

const id = (value: number) => { const bytes = new Uint8Array(16); bytes[15] = value; return bytes; };
const parentIndex = { name: "by_native_id", fields: ["id"], ref: { id: id(11) } };
const childIndex = { name: "by_parent", fields: ["parent_id"], ref: { id: id(12) } };
const parent: CoreTableDefinition = { name: "parent", number: 10001, tabletId: id(1), namespace: null,
  state: "active", indexes: [parentIndex] };
const child: CoreTableDefinition = { name: "child", number: 10002, tabletId: id(2), namespace: null,
  state: "active", indexes: [childIndex] };
const fk: CoreNativeForeignKey = { descriptor: "child_parent_fk", sourceTable: child.name, targetTable: parent.name,
  sourceFields: ["parent_id"], targetFields: ["id"], sourceIndexName: childIndex.name, targetIndexName: parentIndex.name,
  onDelete: "cascade", onUpdate: "noAction" };
const selection = { foreignKey: fk, source: child, target: parent, sourceIndex: childIndex, targetIndex: parentIndex };
type Probe = CorePreparedNativeForeignKeys["demands"][number]["target"];
const publicId = (table: CoreTableDefinition, value: number) => Result.getOrThrow(encodeDocumentId(table.number, id(value)));
const probe = (table: CoreTableDefinition, present = false): Probe => ({ table, index: table === parent ? parentIndex : childIndex,
  interval: { start: Uint8Array.of(10), end: Uint8Array.of(20) },
  entries: new Map(present ? [["0a", publicId(table, 3)]] : []) });
const batch = (...indexes: readonly CorePersistenceIndexEntry[]): CoreWriteBatch => ({ documents: [], indexes });
const write = (table: CoreTableDefinition, value: number | null, key = 10): CorePersistenceIndexEntry => ({ mode: "scanComplete",
  ts: 1n, index: table === parent ? parentIndex.ref : childIndex.ref, key: Uint8Array.of(key), prev: null,
  value: value === null ? null : { tableId: table.tabletId, documentId: id(value) } });
function prepared(target: Probe, incoming?: Probe, deleting = true): CorePreparedNativeForeignKeys {
  return { reads: [], demands: incoming === undefined ? [{ selection, target }] : [],
    releases: incoming === undefined ? [] : [{ selection, target, incoming, deleting }],
    maxIdentities: 16, identities: [], sourceCaptures: [] };
}
const failure = (result: ReturnType<typeof validateCoreNativeForeignKeys>) => Result.isFailure(result) ? result.failure : undefined;

describe("native key and frozen graph integrity", () => {
  it("applies nullable tuple MATCH SIMPLE without confusing a null access prefix with a key", () => {
    expect(Result.getOrThrow(coreNativeKeyTuple({ tenant: "shop", parent: null }, ["tenant", "parent"], true))).toBeNull();
    expect(Result.getOrThrow(coreNativeKeyTuple({ tenant: "shop", parent: "p" }, ["tenant", "parent"], true))).toEqual(["shop", "p"]);
    expect(coreNativeKeyTuple({ tenant: "shop" }, ["tenant", "parent"], true)).toMatchObject({ _tag: "Failure" });
  });

  it("requires native target existence and retains the actual contributing predecessor", () => {
    const state = prepared(probe(parent));
    expect(failure(validateCoreNativeForeignKeys(state, [], batch()))).toMatchObject({ reason: "targetMissing", descriptor: fk.descriptor });
    const inserted = batch(write(parent, 3)), unrelated = batch(write(child, 4));
    expect([...Result.getOrThrow(validateCoreNativeForeignKeys(state, [inserted, unrelated], batch()))]).toEqual([inserted]);
    expect([...Result.getOrThrow(validateCoreNativeForeignKeys(state, [inserted], batch(write(parent, 4))))]).toEqual([]);
    const alreadyPresent = prepared(probe(parent, true));
    expect([...Result.getOrThrow(validateCoreNativeForeignKeys(alreadyPresent, [batch(write(parent, 3))], batch()))]).toEqual([]);
  });

  it("preserves existing children when the same native key is replaced in the candidate", () => {
    const state = prepared(probe(parent, true), probe(child, true));
    const replacement = batch(write(parent, null), write(parent, 4, 11));
    expect(Result.isSuccess(validateCoreNativeForeignKeys(state, [], replacement))).toBe(true);
  });

  it("validates the complete final graph, including noAction siblings already removed by a cascade", () => {
    const state = prepared(probe(parent, true), probe(child, true));
    expect(failure(validateCoreNativeForeignKeys(state, [], batch(write(parent, null)))))
      .toMatchObject({ reason: "deleteRestricted" });
    expect(Result.isSuccess(validateCoreNativeForeignKeys(state, [], batch(write(parent, null), write(child, null))))).toBe(true);
    expect(failure(validateCoreNativeForeignKeys(prepared(probe(parent, true), probe(child, true), false), [], batch(write(parent, null)))))
      .toMatchObject({ reason: "updateRestricted" });
  });

  it("rejects a concurrent incoming member instead of silently widening the sealed cascade", () => {
    const state = prepared(probe(parent, true), probe(child));
    const concurrent = batch(write(child, 4));
    expect(failure(validateCoreNativeForeignKeys(state, [concurrent], batch(write(parent, null)))))
      .toMatchObject({ reason: "deleteRestricted" });
    expect(concurrent.indexes).toHaveLength(1);
  });

  it("folds every accepted suffix and waits for removals that make a final deletion valid", () => {
    const state = prepared(probe(parent, true), probe(child, true));
    const remove = batch(write(child, null)), unrelated = batch(write(child, 7, 30));
    expect([...Result.getOrThrow(validateCoreNativeForeignKeys(state, [remove, unrelated], batch(write(parent, null))))]).toEqual([remove]);
    const restore = batch(write(child, 3));
    expect(failure(validateCoreNativeForeignKeys(state, [remove, restore], batch(write(parent, null)))))
      .toMatchObject({ reason: "deleteRestricted" });
    const targetState = prepared(probe(parent));
    expect(failure(validateCoreNativeForeignKeys(targetState, [batch(write(parent, 3)), batch(write(parent, null))], batch())))
      .toMatchObject({ reason: "targetMissing" });
    const addedChild = batch(write(child, 4)), removedChild = batch(write(child, null));
    expect([...Result.getOrThrow(validateCoreNativeForeignKeys(prepared(probe(parent, true), probe(child)),
      [addedChild, removedChild], batch(write(parent, null))))]).toEqual([removedChild]);
  });

  it("leaves a refused native preflight out of the trusted kernel's pending state", () => Effect.runPromise(Effect.gen(function* () {
    const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [{ name: "name", type: "text" }] }]);
    const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
      scopeUuid: "11111111-1111-4111-8111-111111111111", epochUuid: "22222222-2222-4222-8222-222222222222" });
    const registry = new CoreRegistry(new BTree(), new Map(), new Map());
    const snapshot = { timestamp: 0n, get: () => Effect.succeed(Option.none()),
      scan: () => Effect.succeed({ entries: [], cursor: { kind: "end" as const } }) };
    const limits: CoreNativeLimits = { maxIdentities: 16, maxDocumentBytes: 1024 };
    const vault = new CoreFinalizationVault();
    const transaction = createCoreTransaction({ snapshot, registry, vault,
      ...(yield* prepareCoreTransactionIds({ now: Effect.succeed(1n), randomBytes: length => Effect.succeed(new Uint8Array(length)) })),
      native: { authority: { definition, namespace: null, schemaId: publicId(parent, 8), authorityEpoch: 1n, tables: [] },
        limits, visibility: "command", chargeRetained: () => Effect.void,
        capture: () => Effect.succeed({ snapshot, registry, writeLog: new CoreWriteLog(0n).snapshot() }) } });
    const operations = transaction.nativeOperations;
    if (operations === undefined) return yield* Effect.die(new Error("Missing native operations"));
    const first = yield* Effect.flip(operations.writeRows("missing", "insert", []));
    expect(first).toMatchObject({ reason: "missingTable" });
    const final = vault.take(yield* transaction.transaction.finalize());
    expect(final?.changes).toEqual([]);
    yield* transaction.transaction.abort();
  })));
});
