import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { bytesEqual, compareBytesLexicographically } from "@flarex/utils/bytes";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import type { CoreTableDefinition } from "../../src/core/api";
import type { CoreDocumentLogEntry, CoreIndexScan, CorePersistenceSnapshot } from "../../src/core/contracts";
import { documentIndexKey } from "../../src/core/documentIndex";
import { checkCoreNativeAuthority, makeCoreNativeDefinition, type CoreNativeAuthority } from "../../src/core/nativePolicy";
import { initialRegistry, publicDocumentId, readDocumentObject, type CoreRegistry } from "../../src/core/registry";
import { serializeCoreSchema } from "../../src/core/schemaJson";
import { CoreFinalizationVault, createCoreTransaction } from "../../src/core/transaction";
import { keyInInterval } from "../../src/core/writeLog";

const bytes = (value: number) => { const result = new Uint8Array(16); new DataView(result.buffer).setUint32(12, value); return result; };
const managedTime = "2026-10-31T00:00:00.000Z";
const body = (title: string) => ({ title, createdAt: managedTime, updatedAt: managedTime });
interface Row { readonly id: number; readonly title: string; readonly ts?: bigint }

/** Metadata is seeded through actual registry/codec owners; the reader supplies immutable test pages only. */
async function fixture(visibility: "command" | "snapshot" = "command") {
  const definition = await Effect.runPromise(Effect.gen(function* () {
    const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
      { name: "title", type: "text", required: true, unique: true },
    ] }]);
    return yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
      scopeUuid: "11111111-1111-4111-8111-111111111111", epochUuid: "22222222-2222-4222-8222-222222222222" });
  }));
  const sourceTable = definition.tables[0];
  if (sourceTable === undefined) throw new Error("Missing source table");
  const sourceSchema = definition.schema.tables.find(table => table.tableName === sourceTable.name);
  if (sourceSchema === undefined) throw new Error("Missing source schema");
  const systemTable = (name: string, number: number, identity: number, stateIndex = false): CoreTableDefinition => ({
    name, number, tabletId: bytes(identity), namespace: null, state: "active", indexes: [
      { name: "by_id", ref: { id: bytes(identity + 1) }, fields: [] },
      ...(stateIndex ? [{ name: "by_state", ref: { id: bytes(identity + 2) }, fields: ["state"] }] : []),
    ],
  });
  const schemas = systemTable("_schemas", 532, 10, true);
  const schemaId = Result.getOrThrow(publicDocumentId(schemas, bytes(50)));
  const table: CoreTableDefinition = { name: sourceTable.name, number: 10001, tabletId: bytes(100), namespace: null, state: "active",
    nativePolicy: { state: "active", schemaId, identity: definition.identity, applicationRead: false, uniqueConstraints: sourceTable.uniqueConstraints },
    indexes: [
      { name: "by_id", ref: { id: bytes(101) }, fields: [] },
      { name: "by_creation_time", ref: { id: bytes(102) }, fields: ["_creationTime"] },
      ...sourceSchema.indexes.map((declaration, index) => ({ name: declaration.indexDescriptor,
        ref: { id: bytes(110 + index) }, fields: declaration.fields })),
    ] };
  let registry = Result.getOrThrow(initialRegistry([
    systemTable("_tables", 513, 1), systemTable("_index", 514, 4), schemas, systemTable("_programs", 9999, 20), table,
  ])).withAuthority({ epoch: 0n, id: bytes(60), ts: 1n });
  registry = registry.withSchemas(Result.getOrThrow(registry.schemas.withDocument(null, undefined, {
    id: schemaId, creationTime: 1, value: { state: { state: "active" },
      schema: Result.getOrThrow(serializeCoreSchema(definition.schema)), native: definition.metadata },
  })));
  const authority: CoreNativeAuthority = { definition, namespace: null, schemaId, authorityEpoch: 0n, tables: [table] };
  const calls: CoreIndexScan[] = [];
  const id = (identity: number) => Result.getOrThrow(publicDocumentId(table, bytes(identity)));
  function selected(timestamp: bigint, rows: readonly Row[], selectedRegistry: CoreRegistry = registry) {
    const documents: readonly CoreDocumentLogEntry[] = rows.map(row => ({ ts: row.ts ?? timestamp, tableId: table.tabletId,
      id: bytes(row.id), jsonValue: Result.getOrThrow(encodeDocumentValue({ ...body(row.title), _id: id(row.id), _creationTime: row.id })),
      deleted: false, prevTs: null }));
    const snapshot: CorePersistenceSnapshot = { timestamp,
      get: () => Effect.die(new Error("Native point reads use the source ById index")),
      scan: request => Effect.sync(() => {
        calls.push(request);
        const index = table.indexes.find(candidate => bytesEqual(candidate.ref.id, request.index.id));
        if (index === undefined || !bytesEqual(request.tableId, table.tabletId)) throw new Error("Unexpected physical reader request");
        const entries = documents.map(document => ({ document,
          key: Result.getOrThrow(documentIndexKey(index, Result.getOrThrow(readDocumentObject(document, table)))) }))
          .filter(entry => keyInInterval(entry.key, request.interval))
          .toSorted((left, right) => compareBytesLexicographically(left.key, right.key));
        const page = entries.slice(0, request.maxResults);
        const last = page.at(-1);
        return { entries: page, cursor: entries.length > page.length && last !== undefined
          ? { kind: "after" as const, key: last.key } : { kind: "end" as const } };
      }),
    };
    return { snapshot, registry: selectedRegistry };
  }
  const initial = selected(10n, [{ id: 201, title: "first" }, { id: 202, title: "second" }]);
  let current = initial;
  let generated = 300;
  const vault = new CoreFinalizationVault();
  const assertOwnerOpen = Effect.suspend(() => Effect.fromResult(checkCoreNativeAuthority(current.registry, authority)));
  const context = createCoreTransaction({ ...initial, now: 10n, vault, readonly: visibility === "snapshot",
    newInternalId: Effect.sync(() => bytes(++generated)), assertOwnerOpen,
    native: { authority, visibility, capture: () => Effect.andThen(assertOwnerOpen,
      Effect.sync(() => visibility === "snapshot" ? initial : current)) } });
  const operations = context.nativeOperations;
  if (operations === undefined) throw new Error("Native facade was not issued");
  return { table, id, registry, authority, calls, context, operations, vault,
    publish: (timestamp: bigint, rows: readonly Row[], selectedRegistry?: CoreRegistry) => { current = selected(timestamp, rows, selectedRegistry); },
    finalized: async () => {
      const record = vault.take(await Effect.runPromise(context.transaction.finalize()));
      if (record === undefined) throw new Error("Missing finalized packet");
      return record;
    } };
}

describe("native transaction observations over the source transaction", () => {
  it("remembers first rows and absence while later untouched IDs advance without becoming writes", async () => {
    const tested = await fixture();
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(201)))).title).toBe("first");
    expect(Option.isNone(await Effect.runPromise(tested.operations.get(tested.id(203))))).toBe(true);
    tested.publish(20n, [{ id: 201, title: "changed" }, { id: 203, title: "was-absent" }, { id: 204, title: "fresh" }]);
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(201)))).title).toBe("first");
    expect(Option.isNone(await Effect.runPromise(tested.operations.get(tested.id(203))))).toBe(true);
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(204)))).title).toBe("fresh");
    const finalized = await tested.finalized();
    expect(finalized.changes).toEqual([]);
    expect(finalized.nativeObservations?.dependencies.map(group => group.timestamp)).toEqual([10n, 20n]);
    expect(finalized.reads).toEqual([]);
  });

  it("freezes a complete table after applying earlier remembered rows and absence", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    await Effect.runPromise(tested.operations.get(tested.id(203)));
    tested.publish(20n, [{ id: 201, title: "changed" }, { id: 203, title: "was-absent" }, { id: 204, title: "fresh" }]);
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "all" }))).map(row => row.title))
      .toEqual(["first", "fresh"]);
    tested.publish(30n, [{ id: 205, title: "later" }]);
    expect(Option.isNone(await Effect.runPromise(tested.operations.get(tested.id(205))))).toBe(true);
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "all" }))).map(row => row.title))
      .toEqual(["first", "fresh"]);
    const packet = (await tested.finalized()).nativeObservations;
    const byId = tested.table.indexes.find(index => index.name === "by_id");
    expect(packet?.dependencies.find(group => group.timestamp === 20n)?.reads.some(read => byId !== undefined
      && bytesEqual(read.indexId, byId.ref.id) && read.intervals.some(interval => interval.start === null && interval.end === null))).toBe(true);
  });

  it("does not turn physical cross-index hydration into an earlier title observation", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "changed" }, { id: 202, title: "new-second" }]);
    const found = await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "equal", field: "title", value: "first" }));
    expect(found.map(row => row.title)).toEqual([]);
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(202)))).title).toBe("new-second");
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.uniqueSlots[0]?.owners).toEqual([]);
    expect(packet?.dependencies.map(group => group.timestamp)).toEqual([10n, 20n]);
  });

  it.each(["point", "table"] as const)("retains an empty title membership after a later %s demand observes its new owner", async demand => {
    const tested = await fixture();
    const key = { kind: "equal" as const, field: "title", value: "new-owner" };
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, key))).toEqual([]);
    tested.publish(20n, [{ id: 220, title: "new-owner" }]);
    if (demand === "point") expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(220)))).title).toBe("new-owner");
    else expect((await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "all" }))).map(row => row.title)).toEqual(["new-owner"]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, key))).toEqual([]);
    expect(await Effect.runPromise(tested.operations.insert(tested.table.name, body("new-owner")).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CoreNativeUniqueConflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("rejects a first title capture whose owner revision disagrees with an earlier row observation", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "changed" }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name,
      { kind: "equal", field: "title", value: "changed" }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("uses its frozen table for a title first requested after the scan without creating a key observation", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "changed" }]);
    await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "all" }));
    for (let repeat = 0; repeat < 2; repeat++) expect((await Effect.runPromise(tested.operations.find(tested.table.name,
      { kind: "equal", field: "title", value: "first" }))).map(row => row.title)).toEqual(["first"]);
    expect((await tested.finalized()).nativeObservations?.uniqueSlots).toEqual([]);
  });

  it("keeps checkpoint owner captures separate from writes across release and reacquisition", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.patch(tested.id(201), { title: "moved" }));
    const reclaimed = await Effect.runPromise(tested.operations.insert(tested.table.name, body("first")));
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "equal", field: "title", value: "first" })))
      .map(row => row._id)).toEqual([reclaimed]);
    const duplicate = await Effect.runPromise(tested.operations.insert(tested.table.name, body("moved")).pipe(Effect.result));
    expect(duplicate).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreNativeUniqueConflict",
      tableName: tested.table.name, descriptor: tested.table.nativePolicy?.uniqueConstraints[0]?.descriptor ?? "missing", fields: ["title"],
    } });
    await Effect.runPromise(tested.operations.delete(reclaimed));
    const reacquired = await Effect.runPromise(tested.operations.insert(tested.table.name, body("first")));
    const finalized = await tested.finalized();
    expect(finalized.changes).toHaveLength(3);
    expect(finalized.changes.find(change => bytesEqual(change.id, bytes(201)))?.originalDocument?.title).toBe("first");
    expect(finalized.changes.find(change => bytesEqual(change.id, bytes(201)))?.finalDocument?.title).toBe("moved");
    expect(finalized.nativeObservations?.uniqueSlots.some(slot => slot.owners.includes(tested.id(201)))).toBe(true);
    expect(finalized.changes.some(change => change.finalDocument?._id === reacquired)).toBe(true);
  });

  it("retains empty title owners across a committed claim/release ABA without adding title event dependencies", async () => {
    const tested = await fixture();
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "equal", field: "title", value: "aba" }))).toEqual([]);
    const own = await Effect.runPromise(tested.operations.insert(tested.table.name, body("aba")));
    tested.publish(20n, [{ id: 220, title: "aba" }]);
    tested.publish(30n, [{ id: 220, title: "renamed" }]);
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "equal", field: "title", value: "aba" })))
      .map(row => row._id)).toEqual([own]);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.uniqueSlots).toHaveLength(1);
    expect(packet?.uniqueSlots[0]?.owners).toEqual([]);
    const title = tested.table.indexes.find(index => index.name === tested.table.nativePolicy?.uniqueConstraints[0]?.indexName);
    expect(packet?.dependencies.some(group => group.reads.some(read => title !== undefined && bytesEqual(read.indexId, title.ref.id)))).toBe(false);
  });

  it("keeps standalone reads fixed while refusing revoked metadata before any further disclosure", async () => {
    const tested = await fixture("snapshot");
    tested.publish(20n, [{ id: 201, title: "changed" }, { id: 204, title: "fresh" }]);
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(201)))).title).toBe("first");
    expect(Option.isNone(await Effect.runPromise(tested.operations.get(tested.id(204))))).toBe(true);
    expect(await Effect.runPromise(tested.operations.insert(tested.table.name, body("readonly")).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "readonly" } });
    const title = tested.table.indexes.find(index => index.name === tested.table.nativePolicy?.uniqueConstraints[0]?.indexName);
    if (title === undefined) throw new Error("Missing title index");
    tested.publish(30n, [], tested.registry.withoutIndex(title.ref.id));
    const calls = tested.calls.length;
    expect(await Effect.runPromise(tested.operations.get(tested.id(201)).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    expect(tested.calls).toHaveLength(calls);
    await Effect.runPromise(tested.context.transaction.abort());
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { kind: "all" }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
  });

  it("denies ordinary Application reads and both known-ID and table-name writes to managed tables", async () => {
    const tested = await fixture();
    const transaction = createCoreTransaction({ snapshot: { timestamp: 10n,
      get: () => Effect.die(new Error("Unauthorized access reached storage")),
      scan: () => Effect.die(new Error("Unauthorized access reached storage")) }, registry: tested.registry,
    now: 10n, newInternalId: Effect.succeed(bytes(400)), vault: new CoreFinalizationVault() }).transaction;
    for (const operation of [transaction.get(tested.id(201)), transaction.patch(tested.id(201), { title: "bypass" }),
      transaction.insert(tested.table.name, body("bypass"))]) {
      expect(await Effect.runPromise(operation.pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    }
    await Effect.runPromise(transaction.abort());
  });
});
