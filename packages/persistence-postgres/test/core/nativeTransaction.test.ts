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
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { CoreWriteLog, keyInInterval, type CoreIndexKeys } from "../../src/core/writeLog";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "../../src/core/accounting";
import { CoreNativeObservationState } from "../../src/core/nativeObservations";
import { prepareCoreNativeIndexes, validateCoreNativeIndexes } from "../../src/core/nativeValidation";

const bytes = (value: number) => { const result = new Uint8Array(16); new DataView(result.buffer).setUint32(12, value); return result; };
const managedTime = "2026-10-31T00:00:00.000Z";
const body = (title: string) => ({ title, amount: 15, category: "selected", createdAt: managedTime, updatedAt: managedTime });
interface Row { readonly id: number; readonly title: string; readonly ts?: bigint; readonly amount?: number; readonly category?: string }

/** Metadata is seeded through actual registry/codec owners; the reader supplies immutable test pages only. */
async function fixture(visibility: "command" | "snapshot" = "command", maxIdentities = 256,
  maxDocumentBytes = 65536, retainedMaximum = 1 << 20) {
  const definition = await Effect.runPromise(Effect.gen(function* () {
    const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
      { name: "title", type: "text", required: true, unique: true },
      { name: "amount", type: "number", required: true, index: true },
      { name: "category", type: "text", required: true },
    ], indexes: [{ fields: ["category", "amount"] }] }]);
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
      id: bytes(row.id), jsonValue: Result.getOrThrow(encodeDocumentValue({ ...body(row.title), amount: row.amount ?? 15, category: row.category ?? "selected", _id: id(row.id), _creationTime: row.id })),
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
  const log = new CoreWriteLog(10n);
  const initial = { ...selected(10n, [{ id: 201, title: "first" }, { id: 202, title: "second" }]), writeLog: log.snapshot() };
  let current = initial;
  const vault = new CoreFinalizationVault();
  const retained = new CoreAccounting({ ...CORE_TRANSACTION_REFERENCE_LIMITS, bytesRead: retainedMaximum });
  const assertOwnerOpen = Effect.suspend(() => Effect.fromResult(checkCoreNativeAuthority(current.registry, authority)));
  const context = createCoreTransaction({ ...initial, now: 10n, vault, readonly: visibility === "snapshot",
    idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 10n)), assertOwnerOpen,
    native: { authority, visibility, limits: { maxIdentities, maxDocumentBytes },
      chargeRetained: bytesRead => Effect.fromResult(retained.read(false, bytesRead)), capture: () => Effect.andThen(assertOwnerOpen,
      Effect.sync(() => visibility === "snapshot" ? initial : current)) } });
  const operations = context.nativeOperations;
  if (operations === undefined) throw new Error("Native facade was not issued");
  return { table, id, registry, authority, calls, context, operations, vault, retained,
    current: () => current,
    publish: (timestamp: bigint, rows: readonly Row[], selectedRegistry?: CoreRegistry, transitions: readonly CoreIndexKeys[] = []) => {
      log.append(timestamp, [], undefined, transitions);
      current = { ...selected(timestamp, rows, selectedRegistry), writeLog: log.snapshot() };
    },
    finalized: async () => {
      const record = vault.take(await Effect.runPromise(context.transaction.finalize()));
      if (record === undefined) throw new Error("Missing finalized packet");
      return record;
    } };
}

describe("native transaction observations over the source transaction", () => {
  it("uses a bounded key-only presence witness for a cohort above the row capture cap", async () => {
    const tested = await fixture("command", 128, 1);
    tested.publish(20n, Array.from({ length: 130 }, (_, position) => ({ id: 1000 + position, title: `existing-${position}` })));
    expect(await Effect.runPromise(tested.operations.isEmpty(tested.table.name))).toBe(false);
    expect(tested.calls.at(-1)?.maxResults).toBe(1);
    expect(tested.retained.snapshot().user.bytesRead).toBe(0);
    expect((await Effect.runPromise(tested.context.transaction.usage)).user.documentsRead).toBe(0);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.indexes[0]).toMatchObject({ kind: "range", members: [expect.objectContaining({ id: expect.any(String) })] });
    expect(packet?.indexes[0]?.interval.start).not.toBeNull();
  });

  it("protects an empty presence result against a normal competing insert", async () => {
    const tested = await fixture();
    tested.publish(20n, []);
    expect(await Effect.runPromise(tested.operations.isEmpty(tested.table.name))).toBe(true);
    tested.publish(30n, [{ id: 201, title: "competitor" }]);
    const packet = (await tested.finalized()).nativeObservations;
    if (packet === undefined) throw new Error("Missing native observations");
    const prepared = await Effect.runPromise(prepareCoreNativeIndexes(tested.current().snapshot, tested.registry, packet.indexes, packet.limits.maxIdentities));
    expect(validateCoreNativeIndexes(prepared, [], { documents: [], indexes: [] }, packet.limits.maxIdentities))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
  });

  it("accounts for the common pending overlay in presence without disclosing bodies", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.delete(tested.id(201)));
    await Effect.runPromise(tested.operations.delete(tested.id(202)));
    const before = tested.retained.snapshot().user.bytesRead;
    expect(await Effect.runPromise(tested.operations.isEmpty(tested.table.name))).toBe(true);
    expect(tested.retained.snapshot().user.bytesRead).toBe(before);
    await Effect.runPromise(tested.operations.insert(tested.table.name, body("pending")));
    const calls = tested.calls.length;
    expect(await Effect.runPromise(tested.operations.isEmpty(tested.table.name))).toBe(false);
    expect(tested.calls).toHaveLength(calls);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.indexes.find(slot => slot.kind === "range" && slot.interval.start === null))
      .toMatchObject({ members: [{ id: tested.id(201) }, { id: tested.id(202) }] });
  });

  it("does not turn a positive presence witness into a body revision dependency", async () => {
    const tested = await fixture();
    expect(await Effect.runPromise(tested.operations.isEmpty(tested.table.name))).toBe(false);
    tested.publish(20n, [{ id: 201, title: "first changed" }, { id: 202, title: "second changed" }]);
    const packet = (await tested.finalized()).nativeObservations;
    if (packet === undefined) throw new Error("Missing native observations");
    const prepared = await Effect.runPromise(prepareCoreNativeIndexes(tested.current().snapshot, tested.registry, packet.indexes, packet.limits.maxIdentities));
    expect(Result.isSuccess(validateCoreNativeIndexes(prepared, [], { documents: [], indexes: [] }, packet.limits.maxIdentities))).toBe(true);
  });

  it("keeps source identity caps inside the shared aggregate allowance", async () => {
    const tested = await fixture();
    const second = { ...tested.table, tabletId: bytes(900), number: 10002 };
    const state = new CoreNativeObservationState({ maxIdentities: 3, maxDocumentBytes: 65536 }, [
      { sourceKey: "first", tables: [tested.table], limits: { maxIdentities: 1, maxDocumentBytes: 65536 } },
      { sourceKey: "second", tables: [second], limits: { maxIdentities: 2, maxDocumentBytes: 1024 } },
    ]);
    expect(Result.isSuccess(state.reserve(tested.table, ["a", "a"]))).toBe(true);
    expect(state.reserve(tested.table, ["b"])).toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    expect(Result.isSuccess(state.reserve(second, ["b", "c"]))).toBe(true);
    expect(Result.isSuccess(state.reserve(tested.table, ["a"]))).toBe(true);
    expect(state.limitsFor(second)).toMatchObject({ _tag: "Success", success: { maxDocumentBytes: 1024 } });
    expect(state.reserve({ ...second, tabletId: bytes(901) }, ["d"]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("captures the examined native page prefix without remembering its physical guard", async () => {
    const tested = await fixture();
    const rows = Array.from({ length: 20 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(2, "0")}` }));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, rows);
    const page = await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }));
    expect(page).toMatchObject({ documents: [{ title: "page-00" }], hasMore: true });
    tested.publish(30n, rows.map((row, position) => ({ ...row, ts: position === 16 ? 30n : 20n,
      category: position === 16 ? "guard changed" : "selected" })));
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(1016)))).category).toBe("guard changed");
    const packet = (await tested.finalized()).nativeObservations;
    const slot = packet?.indexes.find(candidate => candidate.kind === "range");
    expect(slot).toMatchObject({ kind: "range", members: rows.slice(0, 16).map(row => ({ id: tested.id(row.id) })) });
    expect(slot?.kind === "range" && slot.members).toHaveLength(16);
    expect(packet?.dependencies.find(group => group.timestamp === 20n)?.reads.find(read => {
      const byId = tested.table.indexes.find(candidate => candidate.name === "by_id");
      return byId !== undefined && bytesEqual(read.indexId, byId.ref.id);
    })?.intervals).toHaveLength(16);
  });

  it("recaptures a repeated native page and refuses a changed remembered body immediately", async () => {
    const tested = await fixture();
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }));
    tested.publish(20n, [{ id: 201, title: "first", category: "changed" }, { id: 202, title: "second", ts: 10n }]);
    expect(await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("keeps ordinary page capture distinct from a later first unique lookup", async () => {
    const tested = await fixture();
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }));
    tested.publish(20n, [{ id: 201, title: "first", amount: 16 }, { id: 202, title: "second", ts: 10n }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { title: "first" }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it.each(["point", "table"] as const)("refuses a fresh page member after its earlier %s absence", async demand => {
    const tested = await fixture();
    if (demand === "point") await Effect.runPromise(tested.operations.get(tested.id(203)));
    else await Effect.runPromise(tested.operations.find(tested.table.name, {}));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, [{ id: 201, title: "first", ts: 10n }, { id: 202, title: "second", ts: 10n }, { id: 203, title: "third" }]);
    expect(await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("accepts unchanged terminal page membership when rows beyond its prefix disappear", async () => {
    const tested = await fixture();
    const rows = Array.from({ length: 20 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(2, "0")}`, ts: 20n }));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, rows);
    await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }));
    tested.publish(30n, rows.slice(0, 16));
    const packet = (await tested.finalized()).nativeObservations;
    if (packet === undefined) throw new Error("Missing native observations");
    const prepared = await Effect.runPromise(prepareCoreNativeIndexes(tested.current().snapshot, tested.registry, packet.indexes, packet.limits.maxIdentities));
    expect(Result.isSuccess(validateCoreNativeIndexes(prepared, [], { documents: [], indexes: [] }, packet.limits.maxIdentities))).toBe(true);
  });

  it("validates EOF against a later phantom even when only one row was returned", async () => {
    const tested = await fixture();
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }));
    tested.publish(20n, [{ id: 201, title: "first", ts: 10n }, { id: 202, title: "second", ts: 10n }, { id: 203, title: "third" }]);
    const packet = (await tested.finalized()).nativeObservations;
    if (packet === undefined) throw new Error("Missing native observations");
    const prepared = await Effect.runPromise(prepareCoreNativeIndexes(tested.current().snapshot, tested.registry, packet.indexes, packet.limits.maxIdentities));
    expect(validateCoreNativeIndexes(prepared, [], { documents: [], indexes: [] }, packet.limits.maxIdentities))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
  });

  it("requires a committed EOF witness for a pending-only page result", async () => {
    const tested = await fixture();
    tested.publish(20n, []);
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    await Effect.runPromise(tested.operations.insert(tested.table.name, body("own")));
    const before = tested.calls.length;
    expect(await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 })))
      .toMatchObject({ documents: [{ title: "own" }], hasMore: false });
    expect(tested.calls.length).toBeGreaterThan(before);
    expect((await tested.finalized()).nativeObservations?.indexes.find(slot => slot.kind === "range"))
      .toMatchObject({ members: [], interval: { end: null } });
  });

  it("charges a page's non-EOF physical guard before any body coherence check", async () => {
    const tested = await fixture("command", 16);
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, Array.from({ length: 20 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(2, "0")}` })));
    expect(await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1 }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    expect((await tested.finalized()).nativeObservations?.indexes).toEqual([]);
  });

  it("stores only detached key membership in unique-slot memos, including observed upgrades", async () => {
    const tested = await fixture();
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    const state = new CoreNativeObservationState({ maxIdentities: 256, maxDocumentBytes: 65536 });
    const interval = { start: null, end: null };
    const slot = { kind: "unique" as const, table: tested.table, index, interval, owners: [tested.id(220)] };
    const rawMember = { id: tested.id(220), key: Uint8Array.of(1),
      observation: { original: { jsonValue: Uint8Array.of(42) }, document: body("undisclosed") } };
    state.rememberSlot(slot, { timestamp: 20n, members: [rawMember] }, false);
    expect(state.slot(index, interval)).toBeUndefined();
    expect(state.slot(index, interval, true)).toEqual({ timestamp: 20n, members: [{ id: tested.id(220), key: Uint8Array.of(1) }] });
    rawMember.key[0] = 2;
    state.rememberSlot(slot, { timestamp: 30n, members: [rawMember] });
    const upgraded = state.slot(index, interval);
    expect(upgraded).toEqual({ timestamp: 30n, members: [{ id: tested.id(220), key: Uint8Array.of(2) }] });
    expect(upgraded?.members[0]).not.toBe(rawMember);
    rawMember.key[0] = 3;
    expect(upgraded?.members[0]?.key).toEqual(Uint8Array.of(2));
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("does not charge or disclose a release-only owner as a semantic capture", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "competitor-moved" }, { id: 220, title: "first" }]);
    await Effect.runPromise(tested.operations.patch(tested.id(201), { title: "own-move" }));
    // Original A plus its staged version; release evidence for B owns no body.
    expect(tested.retained.snapshot().user.documentsRead).toBe(2);
    tested.publish(30n, [{ id: 201, title: "competitor-moved" }, { id: 220, title: "latest" }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { title: "first" }))).toEqual([]);
    expect(tested.retained.snapshot().user.documentsRead).toBe(2);
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(220)))).title).toBe("latest");
    expect(tested.retained.snapshot().user.documentsRead).toBe(3);
    await tested.finalized();
  });

  it("charges each retained original once and every staged body version through the supplied owner", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15 }));
    expect(tested.retained.snapshot().user.documentsRead).toBe(2);
    const captured = tested.retained.snapshot().user.bytesRead;
    await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15 }));
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    expect(tested.retained.snapshot().user.bytesRead).toBe(captured);
    await Effect.runPromise(tested.operations.patch(tested.id(201), { amount: 16 }));
    await Effect.runPromise(tested.operations.patch(tested.id(201), { amount: 17 }));
    expect(tested.retained.snapshot().user.documentsRead).toBe(4);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.limits).toEqual({ maxIdentities: 256, maxDocumentBytes: 65536 });
    expect(Object.hasOwn(packet ?? {}, "chargeRetained")).toBe(false);
  });

  it("refuses oversized originals before residual filtering can hide them", async () => {
    const tested = await fixture("command", 256, 128);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15, unindexed: false }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("uses the supplied cumulative byte owner even when a range has no returned rows", async () => {
    const tested = await fixture("command", 256, 65536, 600);
    Result.getOrThrow(tested.retained.read(false, 500));
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15, unindexed: false }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("refuses a staged body above the document bound before it enters the shared writes map", async () => {
    const tested = await fixture();
    expect(await Effect.runPromise(tested.operations.insert(tested.table.name, body("x".repeat(66000))).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    expect((await tested.finalized()).changes).toEqual([]);
  });
  it("keeps the earlier body after an ordinary-index same-key update, using capture S rather than row R", async () => {
    const tested = await fixture();
    tested.publish(20n, [{ id: 201, title: "captured", ts: 5n }]);
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(30n, [{ id: 201, title: "later" }]);
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { amount: { gte: 10, lt: 20 } })))
      .map(row => row.title)).toEqual(["captured"]);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.dependencies.map(group => group.timestamp)).toEqual([20n, 30n]);
    expect(packet?.indexes.find(slot => slot.kind === "range")).toMatchObject({ members: [{ id: tested.id(201) }] });
  });

  it.each([false, true])("certifies physical key ABA before a pending move can mask it: %s", async pending => {
    const tested = await fixture();
    const index = tested.table.indexes.find(candidate => candidate.fields.length === 1 && candidate.fields[0] === "amount");
    if (index === undefined) throw new Error("Missing amount index");
    const key = (amount: number) => Result.getOrThrow(documentIndexKey(index, { ...body("first"), amount, _id: tested.id(201) }));
    const transitions = [{ indexId: index.ref.id, keys: [key(15), key(35)] }];
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    if (pending) await Effect.runPromise(tested.operations.patch(tested.id(201), { amount: 25 }));
    tested.publish(20n, [{ id: 201, title: "first", amount: 35 }], undefined, transitions);
    tested.publish(30n, [{ id: 201, title: "first", amount: 15 }], undefined, transitions);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: { gte: 10, lt: 20 } }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("does not certify an earlier original that is absent from the physical range", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    await Effect.runPromise(tested.operations.patch(tested.id(201), { amount: 25 }));
    tested.publish(20n, [{ id: 201, title: "first", amount: 35 }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: { gte: 10, lt: 20 } }))).toEqual([]);
    await tested.finalized();
  });

  it.each(["point", "table"] as const)("keeps cached empty range membership after later %s observations", async demand => {
    const tested = await fixture();
    const where = { amount: { gte: 100, lt: 200 } };
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, where))).toEqual([]);
    tested.publish(20n, [{ id: 220, title: "new", amount: 150 }]);
    if (demand === "point") await Effect.runPromise(tested.operations.get(tested.id(220)));
    else await Effect.runPromise(tested.operations.find(tested.table.name, {}));
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, where))).toEqual([]);
    const own = await Effect.runPromise(tested.operations.insert(tested.table.name, { ...body("own"), amount: 150 }));
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, where))).map(row => row._id)).toEqual([own]);
    await tested.finalized();
  });

  it("finishes physical overflow before an earlier row's incompatible-key checkpoint", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "first", amount: 16 },
      ...Array.from({ length: 256 }, (_, position) => ({ id: 1000 + position, title: `other-${position}`, amount: 15 }))]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: { gte: 10, lt: 20 }, unindexed: false }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("counts remembered absence and complete physical candidates in one identity budget before coherence", async () => {
    const tested = await fixture("command", 2);
    await Effect.runPromise(tested.operations.get(tested.id(203)));
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "first", amount: 16 }, { id: 202, title: "second" }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: { gte: 10, lt: 20 } }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "capacity" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("fails closed when a physical member's earlier capture falls below frozen log coverage", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "same" }]);
    tested.publish(400_000_000_000n, [{ id: 201, title: "same" }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15 }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "outOfRetention" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("rejects a fresh physical member whose ID was previously observed absent", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(203)));
    tested.publish(20n, [{ id: 203, title: "appeared" }]);
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15 }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("retains row guards for every physical member even when all are residual-excluded", async () => {
    const tested = await fixture();
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15, unindexed: false }))).toEqual([]);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.indexes.find(slot => slot.kind === "range")).toMatchObject({ members: [
      { id: tested.id(201) }, { id: tested.id(202) },
    ] });
    const byId = tested.table.indexes.find(index => index.name === "by_id");
    expect(packet?.dependencies.find(group => group.timestamp === 10n)?.reads
      .find(dependency => byId !== undefined && bytesEqual(dependency.indexId, byId.ref.id))?.intervals).toHaveLength(2);
  });

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
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, {}))).map(row => row.title))
      .toEqual(["first", "fresh"]);
    tested.publish(30n, [{ id: 205, title: "later" }]);
    expect(Option.isNone(await Effect.runPromise(tested.operations.get(tested.id(205))))).toBe(true);
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, {}))).map(row => row.title))
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
    const found = await Effect.runPromise(tested.operations.find(tested.table.name, { title: "first" }));
    expect(found.map(row => row.title)).toEqual([]);
    expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(202)))).title).toBe("new-second");
    const packet = (await tested.finalized()).nativeObservations;
    expect((packet?.indexes[0]?.kind === "unique" ? packet.indexes[0].owners : undefined)).toEqual([]);
    expect(packet?.dependencies.map(group => group.timestamp)).toEqual([10n, 20n]);
  });

  it.each(["point", "table"] as const)("retains an empty title membership after a later %s demand observes its new owner", async demand => {
    const tested = await fixture();
    const key = { title: "new-owner" };
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, key))).toEqual([]);
    tested.publish(20n, [{ id: 220, title: "new-owner" }]);
    if (demand === "point") expect(Option.getOrThrow(await Effect.runPromise(tested.operations.get(tested.id(220)))).title).toBe("new-owner");
    else expect((await Effect.runPromise(tested.operations.find(tested.table.name, {}))).map(row => row.title)).toEqual(["new-owner"]);
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
      { title: "changed" }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("uses its frozen table for a title first requested after the scan without creating a key observation", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.get(tested.id(201)));
    tested.publish(20n, [{ id: 201, title: "changed" }]);
    await Effect.runPromise(tested.operations.find(tested.table.name, {}));
    for (let repeat = 0; repeat < 2; repeat++) expect((await Effect.runPromise(tested.operations.find(tested.table.name,
      { title: "first" }))).map(row => row.title)).toEqual(["first"]);
    expect((await tested.finalized()).nativeObservations?.indexes).toEqual([]);
  });

  it("keeps checkpoint owner captures separate from writes across release and reacquisition", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.patch(tested.id(201), { title: "moved" }));
    const reclaimed = await Effect.runPromise(tested.operations.insert(tested.table.name, body("first")));
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { title: "first" })))
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
    expect(finalized.nativeObservations?.indexes.some(slot => slot.kind === "unique" && slot.owners.includes(tested.id(201)))).toBe(true);
    expect(finalized.changes.some(change => change.finalDocument?._id === reacquired)).toBe(true);
  });

  it("retains empty title owners across a committed claim/release ABA without adding title event dependencies", async () => {
    const tested = await fixture();
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, { title: "aba" }))).toEqual([]);
    const own = await Effect.runPromise(tested.operations.insert(tested.table.name, body("aba")));
    tested.publish(20n, [{ id: 220, title: "aba" }]);
    tested.publish(30n, [{ id: 220, title: "renamed" }]);
    expect((await Effect.runPromise(tested.operations.find(tested.table.name, { title: "aba" })))
      .map(row => row._id)).toEqual([own]);
    const packet = (await tested.finalized()).nativeObservations;
    expect(packet?.indexes).toHaveLength(1);
    expect((packet?.indexes[0]?.kind === "unique" ? packet.indexes[0].owners : undefined)).toEqual([]);
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
    expect(await Effect.runPromise(tested.operations.find(tested.table.name, {}).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
  });

  it("denies ordinary Application reads and both known-ID and table-name writes to managed tables", async () => {
    const tested = await fixture();
    const transaction = createCoreTransaction({ snapshot: { timestamp: 10n,
      get: () => Effect.die(new Error("Unauthorized access reached storage")),
      scan: () => Effect.die(new Error("Unauthorized access reached storage")) }, registry: tested.registry,
    now: 10n, idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 10n)), vault: new CoreFinalizationVault() }).transaction;
    for (const operation of [transaction.get(tested.id(201)), transaction.patch(tested.id(201), { title: "bypass" }),
      transaction.insert(tested.table.name, body("bypass"))]) {
      expect(await Effect.runPromise(operation.pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    }
    await Effect.runPromise(transaction.abort());
  });
});
