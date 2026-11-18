import { Effect, Exit, Option, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { bytesEqual, compareBytesLexicographically } from "@flarex/utils/bytes";
import { captureDocumentObject, encodeDocumentValue, isProvenScalarDocumentRoot, type DocumentObject } from "flarex-protocol/document-value";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import type { CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexScan, type CorePersistenceSnapshot } from "../../src/core/contracts";
import { makeCoreSnapshotReuse } from "../../src/core/database";
import { documentIndexKey } from "../../src/core/documentIndex";
import { checkCoreNativeAuthority, coreNativeMetadataReads, makeCoreNativeDefinition, type CoreNativeAuthority } from "../../src/core/nativePolicy";
import { initialRegistry, publicDocumentId, readDocumentObject, type CoreRegistry } from "../../src/core/registry";
import { serializeCoreSchema } from "../../src/core/schemaJson";
import { CoreEncodedDocumentHandoff, CoreFinalizationVault, CoreNativeMetadataSelections, createCoreTransaction, deriveCoreWriteBatch } from "../../src/core/transaction";
import { addIndexMetadataDependency } from "../../src/core/dependencies";
import { prefetchCoreNativeFindSlots, prefetchCoreNativeInsertSlots } from "../../src/core/nativePrefetch";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { CoreReadSetBuilder, CoreWriteLog, keyInInterval, type CoreIndexKeys } from "../../src/core/writeLog";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "../../src/core/accounting";
import { CoreNativeObservationState } from "../../src/core/nativeObservations";
import { prepareCoreNativeIndexes, validateCoreNativeIndexes } from "../../src/core/nativeValidation";

const bytes = (value: number) => { const result = new Uint8Array(16); new DataView(result.buffer).setUint32(12, value); return result; };
const managedTime = "2026-10-31T00:00:00.000Z";
const body = (title: string) => ({ title, amount: 15, category: "selected", createdAt: managedTime, updatedAt: managedTime });
interface Row { readonly id: number; readonly title: string; readonly ts?: bigint; readonly amount?: number; readonly category?: string }

/** Metadata is seeded through actual registry/codec owners; the reader supplies immutable test pages only. */
async function fixture(visibility: "command" | "snapshot" = "command", maxIdentities = 256,
  maxDocumentBytes = 65536, retainedMaximum = 1 << 20, nativeReadBatch?: { concurrency: number }, selective?: "frozen" | "mutable") {
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
  // A selective authority is checked on every capture; only a frozen one may keep its derived reads.
  const authority: CoreNativeAuthority = selective === undefined ? { definition, namespace: null, schemaId, authorityEpoch: 0n, tables: [table] }
    : selective === "mutable" ? { definition, namespace: null, schemaId, authorityEpoch: 0n, tables: [table], selectiveMetadata: true }
      : Object.freeze({ definition, namespace: null, schemaId, authorityEpoch: 0n, tables: Object.freeze([Object.freeze(table)]), selectiveMetadata: true });
  const calls: CoreIndexScan[] = [];
  let scanFault: ((request: CoreIndexScan) => Effect.Effect<never, CorePersistenceError> | undefined) | undefined;
  const id = (identity: number) => Result.getOrThrow(publicDocumentId(table, bytes(identity)));
  function selected(timestamp: bigint, rows: readonly Row[], selectedRegistry: CoreRegistry = registry) {
    const documents: readonly CoreDocumentLogEntry[] = rows.map(row => ({ ts: row.ts ?? timestamp, tableId: table.tabletId,
      id: bytes(row.id), jsonValue: Result.getOrThrow(encodeDocumentValue({ ...body(row.title), amount: row.amount ?? 15, category: row.category ?? "selected", _id: id(row.id), _creationTime: row.id })),
      deleted: false, prevTs: null }));
    const snapshot: CorePersistenceSnapshot = { timestamp,
      get: () => Effect.die(new Error("Native point reads use the source ById index")),
      preload: () => Effect.void, scan: request => scanFault?.(request) ?? Effect.sync(() => {
        calls.push(request);
        const index = table.indexes.find(candidate => bytesEqual(candidate.ref.id, request.index.id));
        if (index === undefined || !bytesEqual(request.tableId, table.tabletId)) throw new Error("Unexpected physical reader request");
        const entries = documents.map(document => ({ document,
          key: Result.getOrThrow(documentIndexKey(index, Result.getOrThrow(readDocumentObject(document, table)))) }))
          .filter(entry => keyInInterval(entry.key, request.interval))
          .toSorted((left, right) => (request.order === "desc" ? -1 : 1) * compareBytesLexicographically(left.key, right.key));
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
    ...(nativeReadBatch === undefined ? {} : { nativeReadBatch }),
    idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 10n)), assertOwnerOpen,
    native: { authority, visibility, limits: { maxIdentities, maxDocumentBytes },
      remainingBytes: () => Math.max(0, retainedMaximum - retained.snapshot().user.bytesRead),
      evaluateRelational: () => Effect.die("Unexpected PostgreSQL predicate operation"),
      chargeRetained: bytesRead => Effect.fromResult(retained.read(false, bytesRead)), capture: () => Effect.andThen(assertOwnerOpen,
      Effect.sync(() => visibility === "snapshot" ? initial : current)) } });
  const operations = context.nativeOperations;
  if (operations === undefined) throw new Error("Native facade was not issued");
  return { table, id, registry, authority, calls, context, operations, vault, retained,
    current: () => current,
    setScanFault: (fault: typeof scanFault) => { scanFault = fault; },
    publish: (timestamp: bigint, rows: readonly Row[], selectedRegistry?: CoreRegistry, transitions: readonly CoreIndexKeys[] = [],
      changes: readonly CoreIndexKeys[] = []) => {
      log.append(timestamp, changes, undefined, transitions);
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

  it("retains only successful authority verdicts of frozen authorities for one immutable registry", async () => {
    const tested = await fixture();
    const { definition } = tested.authority;
    // Issuance freezes the complete definition tree before it can be bound.
    const schemaTable = definition.schema.tables[0];
    expect([definition.schema, definition.schema.tables, schemaTable, schemaTable?.indexes].every(value => Object.isFrozen(value))).toBe(true);
    const frozen: CoreNativeAuthority = Object.freeze({ ...tested.authority, tables: Object.freeze([...tested.authority.tables]) });
    expect(Result.isSuccess(checkCoreNativeAuthority(tested.registry, frozen))).toBe(true);
    expect(Result.isSuccess(checkCoreNativeAuthority(tested.registry, frozen, tested.table.name))).toBe(true);
    // A retained verdict covers only this authority's own tables and this exact registry.
    expect(checkCoreNativeAuthority(tested.registry, frozen, "not-bound"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    const revoked = tested.registry.withAuthority({ epoch: 1n, id: bytes(61), ts: 2n });
    expect(checkCoreNativeAuthority(revoked, frozen)).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    // A mutable authority is rechecked on every call, even after it once succeeded.
    const mutable = { ...tested.authority, tables: [...tested.authority.tables] };
    expect(Result.isSuccess(checkCoreNativeAuthority(tested.registry, mutable))).toBe(true);
    mutable.tables = [{ ...tested.table, number: tested.table.number + 1 }];
    expect(checkCoreNativeAuthority(tested.registry, mutable)).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("keeps one metadata read selection per immutable registry, frozen authority and table", async () => {
    const tested = await fixture();
    const frozen: CoreNativeAuthority = Object.freeze({ ...tested.authority,
      tables: Object.freeze(tested.authority.tables.map(table => Object.freeze({ ...table }))) });
    const complete = Result.getOrThrow(coreNativeMetadataReads(tested.registry, frozen));
    const single = Result.getOrThrow(coreNativeMetadataReads(tested.registry, frozen, tested.table.name));
    expect(Result.getOrThrow(coreNativeMetadataReads(tested.registry, frozen))).toBe(complete);
    expect(Result.getOrThrow(coreNativeMetadataReads(tested.registry, frozen, tested.table.name))).toBe(single);
    // A refused table is never kept, and another registry never reuses a kept selection.
    for (let repeat = 0; repeat < 2; repeat++) expect(coreNativeMetadataReads(tested.registry, frozen, "not-bound"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    const revoked = tested.registry.withAuthority({ epoch: 1n, id: bytes(61), ts: 2n });
    expect(coreNativeMetadataReads(revoked, frozen)).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    expect(coreNativeMetadataReads(revoked, frozen, tested.table.name)).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    // A mutable authority is selected again on every call with equal content.
    const mutable = { ...tested.authority, tables: [...tested.authority.tables] };
    const first = Result.getOrThrow(coreNativeMetadataReads(tested.registry, mutable));
    expect(first).not.toBe(complete);
    expect(first).toEqual(complete);
    expect(Result.getOrThrow(coreNativeMetadataReads(tested.registry, mutable))).not.toBe(first);
    mutable.tables = [{ ...tested.table, number: tested.table.number + 1 }];
    expect(coreNativeMetadataReads(tested.registry, mutable)).toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("selects the same dependencies through a transaction's kept metadata selections as without them", async () => {
    const run = async (selective: "frozen" | "mutable") => {
      const tested = await fixture("command", 256, 65536, 1 << 20, undefined, selective);
      const rows = [{ id: 201, title: "first", ts: 10n }, { id: 202, title: "second", ts: 10n }];
      for (const timestamp of [10n, 20n]) {
        // The second round reads a new registry object with equal content at a later timestamp.
        if (timestamp === 20n) tested.publish(20n, rows, tested.registry.withAuthority({ epoch: 0n, id: bytes(60), ts: 1n }));
        for (let repeat = 0; repeat < 2; repeat++) {
          await Effect.runPromise(tested.operations.get(tested.id(201)));
          await Effect.runPromise(tested.operations.find(tested.table.name, { title: "second" }));
          await Effect.runPromise(tested.operations.find(tested.table.name, { amount: 15 }));
          await Effect.runPromise(tested.operations.insert(tested.table.name, body(`pending ${timestamp} ${repeat}`)));
        }
      }
      return tested.finalized();
    };
    const kept = await run("frozen"), plain = await run("mutable");
    expect(kept.nativeObservations?.dependencies.map(group => group.timestamp)).toEqual([10n, 20n]);
    expect(kept.nativeObservations?.dependencies).toEqual(plain.nativeObservations?.dependencies);
    expect(kept.nativeObservations?.indexes).toEqual(plain.nativeObservations?.indexes);
    expect(kept.reads).toEqual(plain.reads);
  });

  it("checks a selective authority and the caller's index on every kept selection", async () => {
    const tested = await fixture();
    if (tested.table.nativePolicy === undefined) throw new Error("Missing native policy");
    // The frozen authority holds its own policy copy, which only the authority check reads.
    const policy = { ...tested.table.nativePolicy };
    const authority: CoreNativeAuthority = Object.freeze({ ...tested.authority, selectiveMetadata: true as const,
      tables: Object.freeze([Object.freeze({ ...tested.table, nativePolicy: policy })]) });
    const selections = new CoreNativeMetadataSelections();
    const first = Result.getOrThrow(selections.native(tested.registry, authority, tested.table.name));
    expect(Result.getOrThrow(selections.native(tested.registry, authority, tested.table.name))).toBe(first);
    expect(first).toEqual(Result.getOrThrow(coreNativeMetadataReads(tested.registry, authority, tested.table.name)));
    expect(first).toEqual(Result.getOrThrow(new CoreNativeMetadataSelections().native(tested.registry, authority, tested.table.name)));
    // A mutable authority and another registry never reuse a kept selection.
    const mutable = { ...authority, tables: [...authority.tables] };
    const unkept = Result.getOrThrow(selections.native(tested.registry, mutable, tested.table.name));
    expect(Result.getOrThrow(selections.native(tested.registry, mutable, tested.table.name))).not.toBe(unkept);
    const advanced = tested.registry.withAuthority({ epoch: 0n, id: bytes(60), ts: 1n });
    const next = Result.getOrThrow(selections.native(advanced, authority, tested.table.name));
    expect(next).not.toBe(first);
    expect(next).toEqual(first);
    expect(selections.native(tested.registry.withAuthority({ epoch: 1n, id: bytes(61), ts: 2n }), authority, tested.table.name))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    for (let repeat = 0; repeat < 2; repeat++) expect(selections.native(tested.registry, authority, "not-bound"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    // The same registry and frozen authority are refused once the check itself refuses.
    policy.applicationRead = true;
    expect(selections.native(tested.registry, authority, tested.table.name))
      .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });

    const title = tested.table.indexes.find(index => index.name === tested.table.nativePolicy?.uniqueConstraints[0]?.indexName);
    if (title === undefined) throw new Error("Missing title index");
    const expected = new CoreReadSetBuilder();
    Result.getOrThrow(addIndexMetadataDependency(expected, tested.registry, title));
    const index = Result.getOrThrow(selections.index(tested.registry, tested.table, title));
    expect(index).toEqual(expected.snapshot());
    expect(Result.getOrThrow(selections.index(tested.registry, tested.table, { ...title }))).toBe(index);
    for (const stale of [{ ...title, ref: { id: bytes(999) } }, { ...title, fields: [...title.fields, "amount"] }])
      expect(selections.index(tested.registry, tested.table, stale)).toMatchObject({ _tag: "Failure", failure: { reason: "indexUnavailable" } });
    expect(selections.index(tested.registry.withoutIndex(title.ref.id), tested.table, title))
      .toMatchObject({ _tag: "Failure", failure: { reason: "indexUnavailable" } });
    expect(Result.getOrThrow(selections.index(advanced, tested.table, title))).toEqual(index);
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("observes a registry advance in the middle of a request after its selections were kept", async () => {
    const refusal = async (selective: "frozen" | "mutable", advance: (registry: CoreRegistry, title: Uint8Array) => CoreRegistry) => {
      const tested = await fixture("command", 256, 65536, 1 << 20, undefined, selective);
      const title = tested.table.indexes.find(index => index.name === tested.table.nativePolicy?.uniqueConstraints[0]?.indexName);
      if (title === undefined) throw new Error("Missing title index");
      for (let repeat = 0; repeat < 2; repeat++)
        expect(await Effect.runPromise(tested.operations.find(tested.table.name, { title: "first" }))).toHaveLength(1);
      tested.publish(20n, [{ id: 201, title: "first", ts: 10n }, { id: 202, title: "second", ts: 10n }], advance(tested.registry, title.ref.id));
      const calls = tested.calls.length;
      const refused = await Effect.runPromise(tested.operations.find(tested.table.name, { title: "second" }).pipe(Effect.result));
      expect(tested.calls).toHaveLength(calls);
      await Effect.runPromise(tested.context.transaction.abort());
      return refused;
    };
    for (const advance of [(registry: CoreRegistry) => registry.withAuthority({ epoch: 1n, id: bytes(61), ts: 2n }),
      (registry: CoreRegistry, title: Uint8Array) => registry.withoutIndex(title)]) {
      const kept = await refusal("frozen", advance);
      expect(kept._tag).toBe("Failure");
      expect(kept).toEqual(await refusal("mutable", advance));
    }
  });

  it("stores the bytes a staged final document was measured with, and the later document after a patch", async () => {
    const tested = await fixture();
    const inserted = await Effect.runPromise(tested.operations.insert(tested.table.name, body("inserted")));
    await Effect.runPromise(tested.operations.patch(inserted, { amount: 16 }));
    await Effect.runPromise(tested.operations.patch(tested.id(201), { amount: 17 }));
    await Effect.runPromise(tested.operations.delete(tested.id(202)));
    const finalized = await tested.finalized();
    const finals = finalized.changes.map(change => change.finalDocument);
    expect(finals.map(document => document?.amount)).toEqual([16, 17, undefined]);
    // Each kept entry is the fresh encoding of the exact final document object.
    const kept = finals.map(document => document === null ? undefined : finalized.encodedDocuments?.take(document));
    for (const [position, document] of finals.entries()) {
      const encoded = kept[position];
      if (document === null) continue;
      if (encoded === undefined) throw new Error("Missing kept final document bytes");
      expect(encoded).toEqual(Result.getOrThrow(encodeDocumentValue(document)));
      finalized.encodedDocuments?.offer(document, encoded);
    }
    const fresh = finals.map(document => document === null ? new Uint8Array() : Result.getOrThrow(encodeDocumentValue(document)));
    const first = Result.getOrThrow(deriveCoreWriteBatch(finalized, 30n));
    expect(first.documents.map(document => document.jsonValue)).toEqual(fresh);
    expect(first.documents.map(document => document.deleted)).toEqual([false, false, true]);
    for (const [position, document] of first.documents.entries()) if (!document.deleted) expect(document.jsonValue).toBe(kept[position]);
    // A taken entry left the handoff, so another batch owns freshly encoded bytes.
    const second = Result.getOrThrow(deriveCoreWriteBatch(finalized, 31n));
    expect(second.documents.map(document => document.jsonValue)).toEqual(fresh);
    for (const [position, document] of second.documents.entries()) if (!document.deleted) expect(document.jsonValue).not.toBe(kept[position]);
  });

  it("walks a staged scalar document once and stores what a body that is not frozen stores", async () => {
    const staged = async (prepare: (value: ReturnType<typeof body>) => ReturnType<typeof body>) => {
      const tested = await fixture();
      const supplied = prepare(body("inserted"));
      const inserted = await Effect.runPromise(tested.operations.insert(tested.table.name, supplied));
      // A body Core did not freeze can still be written by its holder; nothing staged follows it.
      if (!Object.isFrozen(supplied)) { supplied.title = "changed"; supplied.amount = 99; }
      await Effect.runPromise(tested.operations.patch(tested.id(201), prepare({ ...body("first"), amount: 17 })));
      const refused = await Effect.runPromiseExit(tested.operations.insert(tested.table.name, prepare({ ...body("refused"), title: "\ud800" })));
      const usage = await Effect.runPromise(tested.context.transaction.usage);
      const retained = tested.retained.snapshot();
      const finalized = await tested.finalized();
      const finals = finalized.changes.map(change => change.finalDocument);
      const proven = finals.map(document => document !== null && isProvenScalarDocumentRoot(document));
      const kept = finals.map(document => document === null ? undefined : finalized.encodedDocuments?.take(document));
      for (const [position, document] of finals.entries()) {
        const encoded = kept[position];
        if (document === null || encoded === undefined) throw new Error("Missing kept final document bytes");
        expect(encoded).toEqual(Result.getOrThrow(encodeDocumentValue(structuredClone(document))));
        // Staging's walk was the proving one: a second walk would have issued another root.
        expect(Result.getOrThrow(captureDocumentObject(document))).toBe(document);
        finalized.encodedDocuments?.offer(document, encoded);
      }
      const batch = Result.getOrThrow(deriveCoreWriteBatch(finalized, 30n));
      for (const [position, document] of batch.documents.entries()) expect(document.jsonValue).toBe(kept[position]);
      return { inserted, refused, usage, retained, proven, finals,
        stored: batch.documents.map(document => document.jsonValue), indexes: batch.indexes };
    };
    const open = await staged(value => value);
    const frozen = await staged(value => Object.freeze(value));
    expect(frozen.proven).toEqual([true, true]);
    expect(open.proven).toEqual([true, true]);
    expect(frozen.finals.map(document => document?.title)).toEqual(["inserted", "first"]);
    expect(frozen.refused._tag).toBe("Failure");
    expect(frozen).toEqual(open);
  });

  it("encodes a final document with a binary leaf again at commit", async () => {
    const tested = await fixture();
    await Effect.runPromise(tested.operations.patch(tested.id(201), { amount: 17 }));
    const finalized = await tested.finalized();
    const change = finalized.changes[0];
    if (change?.finalDocument == null) throw new Error("Missing final document");
    const leaf = new Uint8Array([1, 2, 3]).buffer;
    const stale = Uint8Array.of(0);
    const handoff = new CoreEncodedDocumentHandoff();
    for (const binary of [Object.freeze({ ...change.finalDocument, blob: leaf }),
      Object.freeze({ ...change.finalDocument, nested: Object.freeze([Object.freeze({ blob: leaf })]) })] satisfies DocumentObject[]) {
      handoff.offer(binary, stale);
      expect(handoff.take(binary)).toBeUndefined();
      const state = { ...finalized, encodedDocuments: handoff, changes: [{ ...change, finalDocument: binary }] };
      handoff.offer(binary, stale);
      const before = Result.getOrThrow(deriveCoreWriteBatch(state, 30n)).documents[0]?.jsonValue;
      expect(before).toEqual(Result.getOrThrow(encodeDocumentValue(binary)));
      // Any holder may write the leaf, and the stored bytes follow it.
      new Uint8Array(leaf)[0] = 9;
      handoff.offer(binary, stale);
      const after = Result.getOrThrow(deriveCoreWriteBatch(state, 31n)).documents[0]?.jsonValue;
      expect(after).toEqual(Result.getOrThrow(encodeDocumentValue(binary)));
      expect(after).not.toEqual(before);
      new Uint8Array(leaf)[0] = 1;
    }
    // A container that is not frozen can change as well and is never kept.
    const open = { ...change.finalDocument };
    handoff.offer(open, stale);
    expect(handoff.take(open)).toBeUndefined();
    const scalar = Object.freeze({ ...change.finalDocument, nested: Object.freeze([Object.freeze({ value: 1n })]) });
    handoff.offer(scalar, stale);
    expect(handoff.take(scalar)).toBe(stale);
    expect(handoff.take(scalar)).toBeUndefined();
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

  it("observes a descending page from the high end and keeps later keys out of its dependency", async () => {
    const tested = await fixture();
    const rows = Array.from({ length: 20 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(2, "0")}`, ts: 20n }));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, rows);
    expect(await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1, order: "desc" })))
      .toMatchObject({ documents: [{ title: "page-19" }], hasMore: true });
    tested.publish(30n, rows.slice(4));
    const packet = (await tested.finalized()).nativeObservations;
    if (packet === undefined) throw new Error("Missing native observations");
    expect(packet.indexes.find(candidate => candidate.kind === "range")).toMatchObject({ kind: "range",
      members: rows.slice(4).toReversed().map(row => ({ id: tested.id(row.id) })) });
    const prepared = await Effect.runPromise(prepareCoreNativeIndexes(tested.current().snapshot, tested.registry, packet.indexes, packet.limits.maxIdentities));
    expect(Result.isSuccess(validateCoreNativeIndexes(prepared, [], { documents: [], indexes: [] }, packet.limits.maxIdentities))).toBe(true);
  });

  it("conflicts when a row enters the observed descending window", async () => {
    const tested = await fixture();
    const rows = Array.from({ length: 20 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(2, "0")}`, ts: 20n }));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, rows);
    await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 1, order: "desc" }));
    tested.publish(30n, [...rows, { id: 2000, title: "page-10a" }]);
    const packet = (await tested.finalized()).nativeObservations;
    if (packet === undefined) throw new Error("Missing native observations");
    const prepared = await Effect.runPromise(prepareCoreNativeIndexes(tested.current().snapshot, tested.registry, packet.indexes, packet.limits.maxIdentities));
    expect(validateCoreNativeIndexes(prepared, [], { documents: [], indexes: [] }, packet.limits.maxIdentities))
      .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
  });

  it("orders a pending row ahead of committed rows in a descending page", async () => {
    const tested = await fixture();
    const rows = Array.from({ length: 20 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(2, "0")}`, ts: 20n }));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, rows);
    await Effect.runPromise(tested.operations.insert(tested.table.name, body("zzz")));
    expect(await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 0, limit: 2, order: "desc" })))
      .toMatchObject({ documents: [{ title: "zzz" }, { title: "page-19" }], hasMore: true });
    await Effect.runPromise(tested.context.transaction.abort());
  });

  it("crosses windows for a descending offset page and places a pending row in order", async () => {
    const tested = await fixture();
    const rows = Array.from({ length: 200 }, (_, position) => ({ id: 1000 + position, title: `page-${String(position).padStart(3, "0")}`, ts: 20n }));
    const index = tested.table.indexes.find(candidate => candidate.fields[0] === "title");
    if (index === undefined) throw new Error("Missing title index");
    tested.publish(20n, rows);
    await Effect.runPromise(tested.operations.insert(tested.table.name, body("page-094a")));
    const page = await Effect.runPromise(tested.operations.findPage(tested.table.name, {}, { indexName: index.name, offset: 100, limit: 8, order: "desc" }));
    expect(page.documents.map(document => document.title)).toEqual(["page-099", "page-098", "page-097", "page-096", "page-095", "page-094a", "page-094", "page-093"]);
    expect(page.hasMore).toBe(true);
    await Effect.runPromise(tested.context.transaction.abort());
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

  it("unites a repeated metadata selection once per timestamp and leaves the dependencies unchanged", () => {
    const selection = (first: number) => {
      const reads = new CoreReadSetBuilder();
      reads.add(Uint8Array.of(7), { start: Uint8Array.of(first), end: Uint8Array.of(first + 2) });
      reads.add(Uint8Array.of(8), { start: null, end: null });
      return reads.snapshot();
    };
    const kept = selection(1), other = selection(2);
    const plain = new CoreNativeObservationState({ maxIdentities: 1, maxDocumentBytes: 1 });
    const skipping = new CoreNativeObservationState({ maxIdentities: 1, maxDocumentBytes: 1 });
    for (const [timestamp, reads] of [[20n, kept], [20n, other], [20n, kept], [30n, kept], [20n, kept], [30n, other], [30n, kept]] as const) {
      plain.addReads(timestamp, reads);
      skipping.addSelectedReads(timestamp, reads);
    }
    expect(skipping.snapshot().dependencies).toEqual(plain.snapshot().dependencies);
    expect(skipping.snapshot().dependencies).toEqual([20n, 30n].map(timestamp => ({ timestamp, reads: [
      { indexId: Uint8Array.of(7), intervals: [{ start: Uint8Array.of(1), end: Uint8Array.of(4) }] },
      { indexId: Uint8Array.of(8), intervals: [{ start: null, end: null }] }] })));
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
      preload: () => Effect.void, scan: () => Effect.die(new Error("Unauthorized access reached storage")) }, registry: tested.registry,
    now: 10n, idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 10n)), vault: new CoreFinalizationVault() }).transaction;
    for (const operation of [transaction.get(tested.id(201)), transaction.patch(tested.id(201), { title: "bypass" }),
      transaction.insert(tested.table.name, body("bypass"))]) {
      expect(await Effect.runPromise(operation.pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
    }
    await Effect.runPromise(transaction.abort());
  });

  describe("overlapped independent slot reads", () => {
    const titleIndex = (table: CoreTableDefinition) => {
      const index = table.indexes.find(candidate => candidate.fields.length === 1 && candidate.fields[0] === "title");
      if (index === undefined) throw new Error("Missing title index");
      return index;
    };
    const titleScans = (calls: readonly CoreIndexScan[], table: CoreTableDefinition) =>
      calls.filter(call => bytesEqual(call.index.id, titleIndex(table).ref.id)).length;
    const outcome = async <A>(work: Effect.Effect<A, unknown>) => {
      const exit = await Effect.runPromiseExit(work);
      return exit._tag === "Success" ? { ok: true } : { ok: false, failure: JSON.parse(JSON.stringify(exit.cause.reasons.map(reason =>
        reason._tag === "Fail" ? { tag: (reason.error as { _tag?: string })._tag, reason: (reason.error as { reason?: string }).reason } : reason._tag))) };
    };

    it("prefetches complete insert slots together and leaves observations, usage and order unchanged", async () => {
      const titles = ["batch-a", "batch-b", "batch-c"];
      const control = await fixture();
      for (const title of titles) await Effect.runPromise(control.operations.insert(control.table.name, body(title)));
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, [{ tableName: tested.table.name, rows: titles.map(body) }]));
      expect(titleScans(tested.calls, tested.table)).toBe(3);
      for (const title of titles) await Effect.runPromise(tested.operations.insert(tested.table.name, body(title)));
      // Each insert consumed its prefetched slot instead of rescanning it.
      expect(titleScans(tested.calls, tested.table)).toBe(3);
      expect(titleScans(control.calls, control.table)).toBe(3);
      expect(await Effect.runPromise(tested.context.transaction.usage)).toEqual(await Effect.runPromise(control.context.transaction.usage));
      expect((await tested.finalized()).nativeObservations).toEqual((await control.finalized()).nativeObservations);
    });

    it("prefetches independent find selections together and leaves observations, usage and results unchanged", async () => {
      const wheres = [{ title: "first" }, { title: "missing" }, { title: "second" }];
      const control = await fixture();
      const expected = [];
      for (const where of wheres) expected.push(await Effect.runPromise(control.operations.find(control.table.name, where)));
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeFindSlots(tested.operations, tested.table.name, wheres));
      expect(titleScans(tested.calls, tested.table)).toBe(3);
      const actual = [];
      for (const where of wheres) actual.push(await Effect.runPromise(tested.operations.find(tested.table.name, where)));
      // Each ordered find consumed its prefetched selection instead of rescanning it.
      expect(titleScans(tested.calls, tested.table)).toBe(3);
      expect(actual).toEqual(expected);
      expect(await Effect.runPromise(tested.context.transaction.usage)).toEqual(await Effect.runPromise(control.context.transaction.usage));
      expect((await tested.finalized()).nativeObservations).toEqual((await control.finalized()).nativeObservations);
    });

    it("hands a prefetched row's decoded document to the find that consumes its slot", async () => {
      const wheres = [{ title: "first" }, { title: "missing" }, { title: "second" }];
      const stored = (text: unknown) => typeof text === "string" && text.includes('"_creationTime"') && text.includes('"title"');
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeFindSlots(tested.operations, tested.table.name, wheres));
      const scans = tested.calls.length;
      const parse = vi.spyOn(JSON, "parse");
      try {
        const found = [];
        for (const where of wheres) found.push(await Effect.runPromise(tested.operations.find(tested.table.name, where)));
        expect(found.map(rows => rows.map(row => row.title))).toEqual([["first"], [], ["second"]]);
        // The prefetch fill decoded both stored rows; their consumers decode nothing.
        expect(tested.calls).toHaveLength(scans);
        expect(parse.mock.calls.filter(([text]) => stored(text))).toHaveLength(0);
      } finally {
        parse.mockRestore();
      }
      await Effect.runPromise(tested.context.transaction.abort());
    });

    it("rereads a prefetched slot that a competing commit touched before consumption", async () => {
      const competitor = { id: 300, title: "contested" };
      const competing = (tested: Awaited<ReturnType<typeof fixture>>) => {
        const document = Result.getOrThrow(readDocumentObject({ ts: 20n, tableId: tested.table.tabletId, id: bytes(competitor.id),
          jsonValue: Result.getOrThrow(encodeDocumentValue({ ...body(competitor.title), _id: tested.id(competitor.id), _creationTime: competitor.id })),
          deleted: false, prevTs: null }, tested.table));
        const key = Result.getOrThrow(documentIndexKey(titleIndex(tested.table), document));
        tested.publish(20n, [{ id: 201, title: "first" }, { id: 202, title: "second" }, competitor], undefined, [],
          [{ indexId: titleIndex(tested.table).ref.id, keys: [key] }]);
      };
      const control = await fixture();
      competing(control);
      const expected = await outcome(control.operations.insert(control.table.name, body(competitor.title)));
      expect(expected.ok).toBe(false);
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, [{ tableName: tested.table.name, rows: [body(competitor.title), body("unrelated")] }]));
      const prefetched = titleScans(tested.calls, tested.table);
      competing(tested);
      expect(await outcome(tested.operations.insert(tested.table.name, body(competitor.title)))).toEqual(expected);
      // The stale absence page was rejected by the write-log suffix and reread at the newer frontier.
      expect(titleScans(tested.calls, tested.table)).toBe(prefetched + 1);
      // An untouched prefetched slot remains reusable at the newer frontier.
      await Effect.runPromise(tested.operations.insert(tested.table.name, body("unrelated")));
      expect(titleScans(tested.calls, tested.table)).toBe(prefetched + 1);
    });

    it("keeps duplicate keys and their failure position identical to sequential inserts", async () => {
      const control = await fixture();
      expect(await outcome(control.operations.insert(control.table.name, body("twice")))).toEqual({ ok: true });
      const expected = await outcome(control.operations.insert(control.table.name, body("twice")));
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, [{ tableName: tested.table.name, rows: [body("twice"), body("twice"), body("once")] }]));
      expect(titleScans(tested.calls, tested.table)).toBe(2);
      expect(await outcome(tested.operations.insert(tested.table.name, body("twice")))).toEqual({ ok: true });
      expect(await outcome(tested.operations.insert(tested.table.name, body("twice")))).toEqual(expected);
      expect(expected.ok).toBe(false);
    });

    it("replaces an earlier batch's unconsumed pages with the next batch", async () => {
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, [{ tableName: tested.table.name, rows: [body("used"), body("dropped")] }]));
      await Effect.runPromise(tested.operations.insert(tested.table.name, body("used")));
      expect(titleScans(tested.calls, tested.table)).toBe(2);
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, [{ tableName: tested.table.name, rows: [body("next-a"), body("next-b")] }]));
      expect(titleScans(tested.calls, tested.table)).toBe(4);
      // The first batch's unconsumed page was released, so this slot is read in place.
      await Effect.runPromise(tested.operations.insert(tested.table.name, body("dropped")));
      expect(titleScans(tested.calls, tested.table)).toBe(5);
      await Effect.runPromise(tested.operations.insert(tested.table.name, body("next-a")));
      expect(titleScans(tested.calls, tested.table)).toBe(5);
    });

    it("overlaps the single slots of one batch call's separate groups together with usage and observations unchanged", async () => {
      const titles = ["family", "envelope", "delivery"];
      const control = await fixture();
      for (const title of titles) await Effect.runPromise(control.operations.insert(control.table.name, body(title)));
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      // No group has two slots of its own; the call's groups share one capture and one range batch.
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, titles.map(title => ({ tableName: tested.table.name, rows: [body(title)] }))));
      expect(titleScans(tested.calls, tested.table)).toBe(3);
      for (const title of titles) await Effect.runPromise(tested.operations.insert(tested.table.name, body(title)));
      expect(titleScans(tested.calls, tested.table)).toBe(3);
      expect(await Effect.runPromise(tested.context.transaction.usage)).toEqual(await Effect.runPromise(control.context.transaction.usage));
      expect((await tested.finalized()).nativeObservations).toEqual((await control.finalized()).nativeObservations);
    });

    it("skips a typed prefetch failure and rereads that slot in place", async () => {
      const control = await fixture();
      const expected = await outcome(control.operations.insert(control.table.name, body("typed-a")));
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      let faulted = 0;
      tested.setScanFault(request => bytesEqual(request.index.id, titleIndex(tested.table).ref.id)
        ? (faulted += 1, Effect.fail(new CorePersistenceError({ reason: "unavailable" }))) : undefined);
      await Effect.runPromise(prefetchCoreNativeInsertSlots(tested.operations, [{ tableName: tested.table.name, rows: [body("typed-a"), body("typed-b")] }]));
      // Both speculative reads were attempted, failed and left nothing behind.
      expect(faulted).toBe(2);
      expect(titleScans(tested.calls, tested.table)).toBe(0);
      tested.setScanFault(undefined);
      expect(await outcome(tested.operations.insert(tested.table.name, body("typed-a")))).toEqual(expected);
      expect(titleScans(tested.calls, tested.table)).toBe(1);
    });

    it("propagates a defect from a speculative slot read with its complete cause", async () => {
      const tested = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      const defect = new Error("speculative read defect");
      tested.setScanFault(request => bytesEqual(request.index.id, titleIndex(tested.table).ref.id) ? Effect.die(defect) : undefined);
      const exit = await Effect.runPromiseExit(prefetchCoreNativeInsertSlots(tested.operations,
        [{ tableName: tested.table.name, rows: [body("dies-a"), body("dies-b")] }]));
      expect(exit._tag).toBe("Failure");
      const reasons = exit._tag === "Failure" ? exit.cause.reasons : [];
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons.every(reason => reason._tag === "Die" && reason.defect === defect)).toBe(true);
    });

    it("does not prefetch without a host bound or for a single independent read", async () => {
      const unbounded = await fixture();
      await Effect.runPromise(prefetchCoreNativeInsertSlots(unbounded.operations, [{ tableName: unbounded.table.name, rows: [body("x"), body("y")] }]));
      expect(titleScans(unbounded.calls, unbounded.table)).toBe(0);
      const single = await fixture("command", 256, 65536, 1 << 20, { concurrency: 4 });
      await Effect.runPromise(prefetchCoreNativeInsertSlots(single.operations, [{ tableName: single.table.name, rows: [body("only")] }]));
      expect(titleScans(single.calls, single.table)).toBe(0);
    });
  });
});

describe("one native transaction's opened persistence snapshot", () => {
  const registries = () => [Result.getOrThrow(initialRegistry([])), Result.getOrThrow(initialRegistry([]))] as const;
  /** Counts openings and applies a floor the way an opening's retention check does. */
  function reuse() {
    const opened: bigint[] = [], rechecked: bigint[] = [];
    const state = { floor: 0n, defect: undefined as Error | undefined };
    const retained = (timestamp: bigint) => timestamp < state.floor
      ? Effect.fail(new CorePersistenceError({ reason: "outOfRetention" })) : Effect.void;
    const tested = makeCoreSnapshotReuse({
      open: timestamp => Effect.andThen(retained(timestamp), Effect.suspend(() => {
        if (state.defect !== undefined) return Effect.die(state.defect);
        opened.push(timestamp);
        const snapshot: CorePersistenceSnapshot = Object.freeze({ timestamp, get: () => Effect.succeed(Option.none()),
          scan: () => Effect.succeed({ entries: [], cursor: { kind: "end" as const } }), preload: () => Effect.void });
        return Effect.succeed(snapshot);
      })),
      recheck: timestamp => Effect.andThen(Effect.sync(() => { rechecked.push(timestamp); }), retained(timestamp)),
    });
    const open = (timestamp: bigint, registry: CoreRegistry) => Effect.runPromise(Effect.exit(tested.guard(tested.open(timestamp, registry))));
    return { tested, open, opened, rechecked, state };
  }
  const value = (exit: Exit.Exit<CorePersistenceSnapshot, CorePersistenceError>) => Exit.isSuccess(exit) ? exit.value : undefined;

  it("returns the held snapshot for the same timestamp and registry after repeating the opening's checks", async () => {
    const { open, opened, rechecked } = reuse(), [registry] = registries();
    const first = value(await open(10n, registry));
    expect(first).toBeDefined();
    expect(value(await open(10n, registry))).toBe(first);
    expect(value(await open(10n, registry))).toBe(first);
    expect(opened).toEqual([10n]);
    expect(rechecked).toEqual([10n, 10n]);
  });

  it("opens another snapshot for another timestamp or another registry and holds only the latest", async () => {
    const { open, opened } = reuse(), [registry, successor] = registries();
    const first = value(await open(10n, registry)), later = value(await open(11n, registry));
    expect(later).not.toBe(first);
    expect(later?.timestamp).toBe(11n);
    expect(value(await open(11n, registry))).toBe(later);
    const other = value(await open(11n, successor));
    expect(other).not.toBe(later);
    expect(value(await open(11n, successor))).toBe(other);
    // The earlier selections are no longer held.
    expect(value(await open(11n, registry))).not.toBe(later);
    expect(value(await open(10n, registry))).not.toBe(first);
    expect(opened).toEqual([10n, 11n, 11n, 11n, 10n]);
  });

  it("refuses a held snapshot once retention passed its timestamp and holds nothing afterwards", async () => {
    const { open, opened, state } = reuse(), [registry] = registries();
    const first = value(await open(10n, registry));
    state.floor = 11n;
    expect(await open(10n, registry)).toMatchObject({ _tag: "Failure", cause: { reasons: [{ _tag: "Fail", error: { reason: "outOfRetention" } }] } });
    state.floor = 0n;
    expect(value(await open(10n, registry))).not.toBe(first);
    expect(opened).toEqual([10n, 10n]);
  });

  it("holds nothing after a capture that dies or is interrupted", async () => {
    const { tested, open, opened, state } = reuse(), [registry] = registries();
    const first = value(await open(10n, registry));
    state.defect = new Error("opening died");
    expect(await open(11n, registry)).toMatchObject({ _tag: "Failure", cause: { reasons: [{ _tag: "Die", defect: state.defect }] } });
    state.defect = undefined;
    expect(value(await open(10n, registry))).not.toBe(first);
    const held = value(await open(10n, registry));
    // A capture that fails after its snapshot was taken ends the reuse too.
    await Effect.runPromise(Effect.exit(tested.guard(Effect.andThen(tested.open(10n, registry), Effect.interrupt))));
    expect(value(await open(10n, registry))).not.toBe(held);
    expect(opened).toEqual([10n, 10n, 10n]);
  });

  it("holds nothing once the transaction ended, including a snapshot opened afterwards", async () => {
    const { tested, open, opened } = reuse(), [registry] = registries();
    const first = value(await open(10n, registry));
    tested.end();
    const after = value(await open(10n, registry));
    expect(after).not.toBe(first);
    expect(value(await open(10n, registry))).not.toBe(after);
    expect(opened).toEqual([10n, 10n, 10n]);
  });
});
