import { randomBytes } from "node:crypto";
import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { openCoreDatabase } from "../../src/core/database";
import { bootstrapCore } from "../../src/core/bootstrap";
import type { CoreDatabase, CoreError, CoreSchemaProposal } from "../../src/core/api";
import type { CoreDocumentLogEntry, CorePersistence } from "../../src/core/contracts";
import { coreIndexMetadataValue } from "../../src/core/indexState";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import { INDEXES, TABLES, publicDocumentId, readDocumentObject, tableDocument } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction, prepareCoreTransactionIds } from "../../src/core/transaction";
import { preparePayloadConformanceSource } from "../integration/payload/payloadNativeManyFixture";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "cd4c19d6-b8d3-4cba-9cf1-f06695472cb9", epochUuid: "da29a197-c236-4e48-afaa-d325dce8851c" };
const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
const ready = Effect.fn("NativeManyPolicy.ready")(function* (database: CoreDatabase, proposal: CoreSchemaProposal, bundle: CoreSchemaBundle) {
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady)
      return yield* database.activateSchema(proposal, { programs: [], bundle });
    if (status.state === "failed" || status.state === "overwritten")
      return yield* Effect.die(new Error(`Native many schema ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 4, maxPages: 4 });
  }
  return yield* Effect.die(new Error("Native many schema did not become ready"));
});
function failure<A>(result: Result.Result<A, CoreError>) { return Result.isFailure(result) ? result.failure : undefined; }
const body = (title: string, relatedPosts: readonly string[] = []) => ({ title, score: 0, enabled: false,
  publishedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  relatedPosts: [...relatedPosts] });
interface StoredRecord { readonly entry: CoreDocumentLogEntry; readonly document: DocumentObject }

export function registerNativeManyPolicyScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("activates the complete private closure without exposing its names or IDs to Application/native CRUD", async () => {
      const producer = await preparePayloadConformanceSource("payload.content-many");
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract, applicationRead: true });
        const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, { ...options, schemaBundles: [bundle] }), db => db.close());
        const before = yield* database.publishedTimestamp;
        expect(failure(yield* Effect.result(database.prepareSchema({ native: definition })))).toMatchObject({ reason: "unsupportedCapability" });
        expect(yield* database.publishedTimestamp).toBe(before);
        const activation = yield* ready(database, yield* database.prepareSchema({ bundle }), bundle);
        expect(activation.tables.map(table => table.name)).toEqual(["posts"]);
        const binding = yield* database.bindNative({ definition });
        expect((yield* database.readNativeBinding(binding)).tables.map(table => table.name)).toEqual(["posts"]);
        const create = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
        const targetId = yield* create.operations.insert("posts", body("private-target"));
        const sourceId = yield* create.operations.insert("posts", body("private-source", [targetId]));
        yield* database.commit(yield* create.finalize());
        const timestamp = yield* database.publishedTimestamp;
        const registry = yield* readCoreFixtureRegistry(fixture, timestamp);
        const privateName = definition.privateTables?.[0]?.name;
        const privateTable = privateName === undefined ? undefined : registry.table(privateName)?.definition;
        const byId = privateTable?.indexes.find(index => index.name === "by_id");
        if (privateTable === undefined || byId === undefined) return yield* Effect.die(new Error("Missing installed private membership table"));
        const snapshot = yield* fixture.persistence.readSnapshot(timestamp);
        const rows = yield* snapshot.scan({ tableId: privateTable.tabletId, index: byId.ref,
          interval: { start: null, end: null }, order: "asc", maxResults: 4 });
        expect(rows.entries).toHaveLength(1);
        const row = rows.entries[0];
        if (row === undefined) return yield* Effect.die(new Error("Missing actual derived membership"));
        expect(yield* Effect.fromResult(readDocumentObject(row.document, privateTable))).toMatchObject({ sourceId, targetId });
        const childId = yield* Effect.fromResult(publicDocumentId(privateTable, row.document.id));
        const app = yield* database.begin();
        expect((yield* app.tableMappings).map(table => table.logicalName)).toEqual(["posts"]);
        yield* app.abort();
        const appRead = yield* database.begin();
        expect(failure(yield* Effect.result(appRead.get(childId)))).toMatchObject({ reason: "authorityRevoked" });
        yield* appRead.abort();
        const appWrite = yield* database.begin();
        expect(failure(yield* Effect.result(appWrite.insert(privateTable.name, { sourceId, targetId })))).toMatchObject({ reason: "authorityRevoked" });
        yield* appWrite.abort();
        for (const operation of ["get", "getMany", "normalizeId", "insert", "patch", "delete"] as const) {
          const native = yield* database.beginNative(binding, { ...coreNativeTestBudget(), commandName: "payload-create" });
          const refused = yield* Effect.result(Effect.gen(function* () {
            switch (operation) {
              case "get": return yield* native.operations.get(childId);
              case "getMany": return yield* native.operations.getMany(privateTable.name, [childId]);
              case "normalizeId": return yield* native.operations.normalizeId(privateTable.name, childId);
              case "insert": return yield* native.operations.insert(privateTable.name, { sourceId, targetId });
              case "patch": return yield* native.operations.patch(childId, { sourceId });
              case "delete": return yield* native.operations.delete(childId);
            }
          }));
          expect(failure(refused)).toMatchObject({ reason: "authorityRevoked" });
          yield* native.abort();
        }
        expect(yield* database.publishedTimestamp).toBe(timestamp);
        const tables = yield* Effect.tryPromise({ try: () => fixture.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name", [fixture.namespace]),
        catch: cause => new Error("Could not inspect the owned fixture's physical tables", { cause }) });
        expect(tables).toEqual(["documents", "indexes", "leases", "persistence_globals", "read_only"].map(table_name => ({ table_name })));
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("rejects missing/extra private ownership, foreign roles and changed index coverage on actual cold reopen", async () => {
      const producer = await preparePayloadConformanceSource("payload.content-many");
      const fixture = await createFixture();
      const observed = new Map<string, StoredRecord>();
      try {
        const installed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract });
          const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
          const privateName = definition.privateTables?.[0]?.name;
          if (privateName === undefined) return yield* Effect.die(new Error("Missing derived table declaration"));
          const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
            yield* fixture.persistence.write(lease, batch);
            for (const entry of batch.documents) {
              if (entry.deleted) continue;
              const document = yield* Effect.fromResult(readDocumentObject(entry));
              if (document.name === privateName) observed.set("private", { entry, document });
              if (document.name === "posts") observed.set("public", { entry, document });
              if (document.descriptor === "by_target_source") observed.set("index", { entry, document });
            }
          }) };
          const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { ...options, schemaBundles: [bundle] }), db => db.close());
          yield* ready(database, yield* database.prepareSchema({ bundle }), bundle);
          const timestamp = yield* database.publishedTimestamp;
          const registry = yield* readCoreFixtureRegistry(fixture, timestamp);
          const table = registry.table(privateName)?.definition, publicTable = registry.table("posts")?.definition;
          if (table?.nativePolicy?.privateReference === undefined || publicTable?.nativePolicy === undefined)
            return yield* Effect.die(new Error("Missing installed private/public policy"));
          return { bundle, definition, table, publicTable, timestamp };
        })));
        const privateRecord = observed.get("private"), publicRecord = observed.get("public"), indexRecord = observed.get("index");
        const policy = installed.table.nativePolicy;
        if (privateRecord === undefined || publicRecord === undefined || indexRecord === undefined || policy?.privateReference === undefined)
          throw new Error("Missing actual metadata records");
        const { privateReference: _privateRole, ...unmarked } = policy;
        const mutations: readonly Readonly<{ record: StoredRecord; body: DocumentObject }>[] = [
          { record: privateRecord, body: tableDocument({ ...installed.table, name: `${installed.table.name}x` }) },
          { record: privateRecord, body: tableDocument({ ...installed.table, nativePolicy: unmarked }) },
          { record: privateRecord, body: tableDocument({ ...installed.table, nativePolicy: { ...policy, applicationRead: true } }) },
          { record: privateRecord, body: tableDocument({ ...installed.table, nativePolicy: { ...policy,
            privateReference: { kind: "referenceMembership", referenceName: `${policy.privateReference.referenceName}/foreign` } } }) },
          { record: privateRecord, body: tableDocument({ ...installed.table, nativePolicy: { ...policy,
            identity: { ...policy.identity, sourceKey: "foreign-owner" } } }) },
          { record: publicRecord, body: tableDocument({ ...installed.publicTable, nativePolicy: policy }) },
          { record: indexRecord, body: { ...indexRecord.document, config: { type: "database", fields: ["sourceId", "targetId"],
            onDiskState: { type: "Enabled" } } } },
        ];
        const noProofPersistence = await fixture.reopen();
        const noProof = await Effect.runPromise(Effect.scoped(Effect.result(Effect.acquireRelease(
          openCoreDatabase(noProofPersistence, options), db => db.close()))));
        expect(failure(noProof)).toMatchObject({ reason: "corruptData" });
        for (const mutation of mutations) {
          const encoded = { ...mutation.record.document, ...mutation.body };
          await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [Result.getOrThrow(encodeDocumentValue(encoded)), fixture.instanceName, mutation.record.entry.tableId,
            mutation.record.entry.id, mutation.record.entry.ts.toString()]);
          try {
            const reopened = await fixture.reopen();
            const refused = await Effect.runPromise(Effect.scoped(Effect.result(Effect.acquireRelease(
              openCoreDatabase(reopened, { ...options, schemaBundles: [installed.bundle] }), db => db.close()))));
            expect(failure(refused)).toMatchObject({ reason: "corruptData" });
          } finally {
            await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
              WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
            [mutation.record.entry.jsonValue, fixture.instanceName, mutation.record.entry.tableId,
              mutation.record.entry.id, mutation.record.entry.ts.toString()]);
          }
        }
        const restoredPersistence = await fixture.reopen();
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const restored = yield* Effect.acquireRelease(openCoreDatabase(restoredPersistence,
            { ...options, schemaBundles: [installed.bundle] }), db => db.close());
          expect(yield* restored.publishedTimestamp).toBe(installed.timestamp);
          expect((yield* restored.readNativeBinding(yield* restored.bindNative({ definition: installed.definition }))).tables)
            .toHaveLength(1);
        })));
      } finally { await fixture.close(); }
    }, 90_000);

    it("rejects extra private table and index candidates at the shared finalization owner", async () => {
      const producer = await preparePayloadConformanceSource("payload.content-many");
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract });
        const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
        const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, { ...options, schemaBundles: [bundle] }), db => db.close());
        yield* ready(database, yield* database.prepareSchema({ bundle }), bundle);
        const timestamp = yield* database.publishedTimestamp;
        yield* database.close();
        const lease = yield* fixture.persistence.acquireLease();
        const initial = yield* bootstrapCore(fixture.persistence, lease, { ...options, schemaBundles: [bundle] });
        const privateName = definition.privateTables?.[0]?.name;
        const table = privateName === undefined ? undefined : initial.registry.table(privateName)?.definition;
        const index = table === undefined ? undefined : initial.registry.indexesForTablet(table.tabletId).find(value => value.name === "by_target_source");
        if (table === undefined || index === undefined) return yield* Effect.die(new Error("Missing private table/index for candidate test"));
        for (const kind of ["table", "index"] as const) {
          const context = createCoreTransaction({ snapshot: yield* fixture.persistence.readSnapshot(initial.timestamp, initial.retention),
            registry: initial.registry, ...(yield* prepareCoreTransactionIds(options)), vault: new CoreFinalizationVault(), schemaBundles: [bundle] });
          const refused = yield* Effect.result(Effect.gen(function* () {
            if (kind === "table") {
              const extra = { ...table, name: `${table.name}x`, tabletId: randomBytes(16),
                number: Math.max(...[...initial.registry.tables.values()].map(row => row.definition.number)) + 1 };
              yield* context.writePrivate(TABLES, extra.tabletId, tableDocument(extra));
            } else {
              const id = randomBytes(16);
              yield* context.writePrivate(INDEXES, id, coreIndexMetadataValue({ ...index, name: "unexpected_private_index", ref: { id } }));
            }
            return yield* context.transaction.finalize();
          }).pipe(Effect.ensuring(context.transaction.abort())));
          expect(failure(refused)).toMatchObject({ reason: "corruptData" });
        }
        expect(yield* fixture.persistence.latestTimestamp(lease)).toBe(timestamp);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("refuses malformed members, a wrong reverse key, orphan sources and unchanged-revision source disagreement", async () => {
      const producer = await preparePayloadConformanceSource("payload.content-many");
      const fixture = await createFixture();
      try {
        const installed = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract });
          const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
          const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, { ...options, schemaBundles: [bundle] }), db => db.close());
          yield* ready(database, yield* database.prepareSchema({ bundle }), bundle);
          const native = yield* database.beginNative(yield* database.bindNative({ definition }),
            { ...coreNativeTestBudget(), commandName: "payload-create" });
          const first = yield* native.operations.insert("posts", body("corruption-first"));
          const second = yield* native.operations.insert("posts", body("corruption-second"));
          const source = yield* native.operations.insert("posts", body("corruption-source", [first, second]));
          yield* database.commit(yield* native.finalize());
          const timestamp = yield* database.publishedTimestamp;
          const registry = yield* readCoreFixtureRegistry(fixture, timestamp);
          const privateName = definition.privateTables?.[0]?.name;
          const privateTable = privateName === undefined ? undefined : registry.table(privateName)?.definition;
          const sourceTable = registry.table("posts")?.definition;
          const byId = privateTable?.indexes.find(index => index.name === "by_id");
          if (privateTable === undefined || sourceTable === undefined || byId === undefined)
            return yield* Effect.die(new Error("Missing actual private projection"));
          const snapshot = yield* fixture.persistence.readSnapshot(timestamp);
          const rows = yield* snapshot.scan({ tableId: privateTable.tabletId, index: byId.ref,
            interval: { start: null, end: null }, order: "asc", maxResults: 4 });
          let member: StoredRecord | undefined;
          for (const row of rows.entries) {
            const document = yield* Effect.fromResult(readDocumentObject(row.document, privateTable));
            if (document.targetId === first) member = { entry: row.document, document };
          }
          const sourceIdentity = yield* Effect.fromResult(decodeDocumentId(source));
          const sourceRow = yield* snapshot.get(sourceTable.tabletId, sourceIdentity.internalId);
          if (member === undefined || Option.isNone(sourceRow) || sourceRow.value.deleted)
            return yield* Effect.die(new Error("Missing actual source/member revisions"));
          return { definition, bundle, first, second, member,
            source: { entry: sourceRow.value, document: yield* Effect.fromResult(readDocumentObject(sourceRow.value, sourceTable)) } };
        })));
        const cases = [
          { name: "malformed child", record: installed.member, bytes: new Uint8Array([255]), deleted: false },
          // Both targets are in the source array. Source membership alone must
          // not hide a child body that disagrees with the consumed index key.
          { name: "wrong target/index key", record: installed.member,
            bytes: Result.getOrThrow(encodeDocumentValue({ ...installed.member.document, targetId: installed.second })), deleted: false },
          { name: "orphan source", record: installed.source, bytes: new Uint8Array(), deleted: true },
          { name: "same-revision source mismatch", record: installed.source,
            bytes: Result.getOrThrow(encodeDocumentValue({ ...installed.source.document, relatedPosts: [installed.second] })), deleted: false },
        ];
        for (const mutation of cases) {
          await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1,deleted=$2
            WHERE instance_name=$3 AND table_id=$4 AND id=$5 AND ts=$6`,
          [mutation.bytes, mutation.deleted, fixture.instanceName, mutation.record.entry.tableId,
            mutation.record.entry.id, mutation.record.entry.ts.toString()]);
          try {
            const persistence = await fixture.reopen();
            const refused = await Effect.runPromise(Effect.scoped(Effect.result(Effect.gen(function* () {
              const database = yield* Effect.acquireRelease(openCoreDatabase(persistence,
                { ...options, schemaBundles: [installed.bundle] }), db => db.close());
              const native = yield* database.beginNative(yield* database.bindNative({ definition: installed.definition }),
                { ...coreNativeTestBudget(), commandName: "payload-find" });
              return yield* native.operations.incomingReferences("relatedPosts", installed.first, { limit: 16 })
                .pipe(Effect.ensuring(native.abort()));
            }))));
            expect(failure(refused), mutation.name).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
          } finally {
            await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1,deleted=$2
              WHERE instance_name=$3 AND table_id=$4 AND id=$5 AND ts=$6`,
            [mutation.record.entry.jsonValue, mutation.record.entry.deleted, fixture.instanceName,
              mutation.record.entry.tableId, mutation.record.entry.id, mutation.record.entry.ts.toString()]);
          }
        }
      } finally { await fixture.close(); }
    }, 90_000);
  });
}
