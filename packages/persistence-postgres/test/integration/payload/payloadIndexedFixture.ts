import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../../../payload-adapter/src/collections";
import { createCorePayloadFixture, type CorePayloadFixture, type CorePayloadFixtureTarget, type CorePayloadFixtureOptions } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { Effect, Schema, type Scope } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { CoreError, CoreIndexDefinition, CoreTableDefinition } from "../../../src/core/api";
import type { CoreIndexPage, CorePersistenceSnapshot } from "../../../src/core/contracts";
import type { DocumentObject } from "flarex-protocol/document-value";
import { readDocumentObject, REQUESTS } from "../../../src/core/registry";
import type { CoreSqlConnection, CoreSqlDriver, CoreSqlParameter } from "../../../src/database/corePersistence/driver";
import { defineCmsCommand, type CmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import type { CmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { readCoreFixtureRegistry } from "../../core/fixture";
import { coreNativeConstraintFields, coreNativeConstraintNullsDistinct } from "../../../src/core/nativePolicy";
import { expect } from "vitest";

const decodeBatch = Schema.decodeUnknownEffect(Schema.Number);
export const indexedFields = (title: string, category: string, amount: number) => ({ title, category, amount,
  createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" });
export const decodeIndexedPage = Schema.decodeUnknownSync(Schema.Struct({ totalDocs: Schema.Number,
  docs: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, amount: Schema.Number })) }));
export const decodeIndexedDocument = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String, amount: Schema.Number }));
export interface IndexedSqlObservation { readonly sql: string; readonly params: readonly CoreSqlParameter[] }
interface IndexedIndexEntry { readonly key: string; readonly id: string; readonly ts: bigint; readonly document: DocumentObject }
export interface IndexedPayloadInventory {
  readonly rows: readonly DocumentObject[];
  readonly revisions: readonly Readonly<{ id: string; ts: bigint; deleted: boolean; value: string }>[];
  readonly indexes: readonly Readonly<{ name: string; entries: readonly IndexedIndexEntry[] }>[];
  readonly outcomes: readonly DocumentObject[];
}
export interface IndexedPayloadFixture {
  readonly core: CorePayloadFixture;
  readonly compiled: CompiledPayloadCollections;
  readonly runtime: CorePayloadFixture["runtime"];
  readonly host: CmsHost;
  readonly seed: CmsCommand;
  readonly openHost: CorePayloadFixture["openHost"];
  readonly inventory: () => Promise<IndexedPayloadInventory>;
  readonly plans: readonly IndexedSqlObservation[];
  readonly resetObservations: () => void;
  readonly reopen: () => Promise<void>;
  readonly applicationIndexQueries: (from?: number) => Promise<readonly IndexedSqlObservation[]>;
  readonly applicationTableQueries: (from?: number) => Promise<readonly IndexedSqlObservation[]>;
}

const readIndex = Effect.fn("IndexedPayload.readIndex")(function* (
  snapshot: CorePersistenceSnapshot, table: CoreTableDefinition, index: CoreIndexDefinition,
) {
  const entries: IndexedIndexEntry[] = [];
  let start: Uint8Array | null = null;
  while (true) {
    const page: CoreIndexPage = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref, interval: { start, end: null }, order: "asc", maxResults: 128 });
    for (const entry of page.entries) entries.push({ key: encodeBytesToLowercaseHex(entry.key),
      id: encodeBytesToLowercaseHex(entry.document.id), ts: entry.document.ts,
      document: yield* Effect.fromResult(readDocumentObject(entry.document, table)) });
    if (page.cursor.kind === "end") return entries;
    start = new Uint8Array(page.cursor.key.length + 1);
    start.set(page.cursor.key);
  }
});

/** Existing indexed consumer over the single genuine Core/Payload fixture owner. */
export const makeIndexedPayloadFixture: (
  target: CorePayloadFixtureTarget, configuration?: CompiledPayloadCollections,
  options?: Pick<CorePayloadFixtureOptions, "scopeUuid" | "epochUuid">,
) => Effect.Effect<IndexedPayloadFixture, unknown, Scope.Scope> = Effect.fn("IndexedPayload.fixture")(function* (
  target: CorePayloadFixtureTarget, configuration?: CompiledPayloadCollections,
  options: Pick<CorePayloadFixtureOptions, "scopeUuid" | "epochUuid"> = {},
) {
  const compiled = configuration ?? (yield* compilePayloadCollections([{ slug: "items", fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "category", type: "text", required: true },
    { name: "amount", type: "number", required: true, index: true },
  ], indexes: [{ fields: ["category", "amount"] }] }]));
  const plans: IndexedSqlObservation[] = [];
  let recording = true;
  const record = (connection: CoreSqlConnection): CoreSqlConnection => ({ query: (sql, params = []) =>
    Effect.sync(() => { if (recording) plans.push({ sql, params: params.map(value => value instanceof Uint8Array ? value.slice() : value) }); })
      .pipe(Effect.andThen(connection.query(sql, params))) });
  const wrapRuntimeDriver = (driver: CoreSqlDriver): CoreSqlDriver => ({ query: record(driver).query,
    withConnection: run => driver.withConnection(connection => run(record(connection))),
    transaction: run => driver.transaction(connection => run(record(connection))),
  });
  const core = yield* Effect.acquireRelease(Effect.tryPromise({
    try: () => createCorePayloadFixture(target, { ...options, compiled, wrapRuntimeDriver }), catch: cause => cause,
  }), value => Effect.tryPromise({ try: value.close, catch: cause => cause }).pipe(Effect.orDie));
  const seed = defineCmsCommand({ name: "seedIndexedRows", mode: "write", run: Effect.fn(function* (ctx, args) {
    const batch = yield* decodeBatch(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    for (let position = 0; position < 16; position++) {
      const value = batch * 16 + position;
      yield* ctx.documents.insert(ctx.context, ctx.transactionId, "items", indexedFields(`seed-${value}`, "unrelated", 1000 + value));
    }
    return null;
  }) });
  let host = yield* core.openHost([seed]);
  const inventory = async () => {
    const previous = recording;
    recording = false;
    try { return await core.run(Effect.gen(function* () {
    const timestamp = yield* core.database.publishedTimestamp;
    const snapshot = yield* core.persistence.readSnapshot(timestamp);
    const metadata = yield* core.database.readNativeBinding(core.binding);
    const table = metadata.tables.find(candidate => candidate.name === "items");
    const byId = table?.indexes.find(index => index.name === "by_id");
    if (table === undefined || byId === undefined) throw new Error("Missing native items table");
    const rows = (yield* readIndex(snapshot, table, byId)).map(entry => entry.document);
    const indexes = yield* Effect.forEach(table.indexes, index => readIndex(snapshot, table, index).pipe(
      Effect.map(entries => ({ name: index.name, entries }))));
    const revisions: Array<Readonly<{ id: string; ts: bigint; deleted: boolean; value: string }>> = [];
    let after: import("../../../src/core/contracts").CoreDocumentLogCursor | undefined;
    while (true) {
      const page = yield* core.persistence.loadDocuments({ start: 0n, end: timestamp, tableId: table.tabletId,
        order: "asc", maxResults: 128, ...(after === undefined ? {} : { after }) });
      for (const entry of page.documents) revisions.push({ id: encodeBytesToLowercaseHex(entry.id), ts: entry.ts,
        deleted: entry.deleted, value: encodeBytesToLowercaseHex(entry.jsonValue) });
      if (page.done) break;
      if (page.cursor === null) throw new Error("Missing document history continuation");
      after = page.cursor;
    }
    const registry = yield* readCoreFixtureRegistry({ persistence: core.persistence }, timestamp);
    const requests = registry.table(REQUESTS)?.definition;
    const requestIndex = requests?.indexes.find(index => index.name === "by_id");
    if (requests === undefined || requestIndex === undefined) throw new Error("Missing native request outcomes");
    const outcomes = (yield* readIndex(snapshot, requests, requestIndex)).map(entry => entry.document)
      .filter(document => document.kind === "native" && document.state === "committed");
    return { rows, revisions, indexes, outcomes };
    })); } finally { recording = previous; }
  };
  const applicationQueries = async (byId: boolean, from: number) => {
    const metadata = await core.run(core.database.readNativeBinding(core.binding));
    const table = metadata.tables.find(candidate => candidate.name === "items");
    if (table === undefined) throw new Error("Missing native table metadata");
    return plans.slice(from).filter(plan => /SELECT/i.test(plan.sql) && /FROM\s+[^\s]+\."indexes"/.test(plan.sql)
      && (!byId || !/\(key_prefix, key_sha256\) <=/.test(plan.sql))
      && plan.params.some(value => value instanceof Uint8Array && table.indexes.some(index =>
        (byId ? index.name === "by_id" : index.name !== "by_id") && bytesEqual(index.ref.id, value))));
  };
  plans.length = 0;
  return { core, compiled, get runtime() { return core.runtime; }, get host() { return host; }, seed,
    openHost: core.openHost, inventory, plans, resetObservations: () => { plans.length = 0; },
    reopen: async () => { await core.reopen(); host = await core.run(core.openHost([seed])); },
    applicationIndexQueries: (from = 0) => applicationQueries(false, from),
    applicationTableQueries: (from = 0) => applicationQueries(true, from),
  };
});
/** Compare actual bound policy with the genuine producer's declarations. */
export const assertNativeConstraintBinding = Effect.fn("IndexedPayload.assertNativeConstraints")(function* (
  tested: IndexedPayloadFixture,
): Effect.fn.Return<void, CoreError> {
  const metadata = yield* tested.core.database.readNativeBinding(tested.core.binding);
  const table = metadata.tables.find(candidate => candidate.name === "items");
  if (table?.nativePolicy === undefined) throw new Error("Missing authenticated native policy");
  expect(table.nativePolicy.identity).toEqual(tested.core.definition.identity);
  expect(table.nativePolicy.uniqueConstraints.map(constraint => ({ descriptor: constraint.descriptor,
    fields: coreNativeConstraintFields(constraint), nullsDistinct: coreNativeConstraintNullsDistinct(constraint) })))
    .toEqual(tested.compiled.logicalDefinition.uniqueConstraints.map(constraint => ({ descriptor: constraint.descriptor,
      fields: constraint.fields, nullsDistinct: constraint.nullsDistinct === true })));
});
