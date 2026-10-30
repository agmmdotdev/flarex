import { randomBytes } from "node:crypto";
import { Clock, Deferred, Effect, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "../../src/core/database";
import { bootstrapCore } from "../../src/core/bootstrap";
import { bytesEqual } from "@flarex/utils/bytes";
import { issueFinalizedTransaction, type CoreDatabaseOptions, type CoreFinalizedTransaction, type CoreRequestClaim, type CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence } from "../../src/core/contracts";
import { captureDocumentObject, captureDocumentObjectWithSize, captureDocumentValue, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { PROGRAMS, readDocumentObject } from "../../src/core/registry";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { captureCoreSchema } from "../../src/core/schemaTypes";

const id = (last: number) => { const bytes = new Uint8Array(16); bytes[15] = last; return bytes; };
const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)) };
const identity = { functionPath: "users:deleteThroughInternal", programHash: "program-a", schemaHash: "schema-a" };
const schema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{
  tableName: "users", documentType: { type: "object", value: {
    name: { fieldType: { type: "string" }, optional: false }, padding: { fieldType: { type: "string" }, optional: true },
  } }, indexes: [{ indexDescriptor: "by_name", fields: ["name", "_creationTime"] }],
}] }));
const publication = { authorityEpoch: 1n, programs: [{ identity, metadata: { artifact: "immutable-source" } }] };

export function registerCoreBootstrapScenarios(name: string, createFixture: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>) {
describe(name, () => {
  it.each([0, 100])("uses resident metadata and local leader retention with shared verification at %i percent", async verifyPercent => {
    const statements: string[] = [];
    const fixture = await createFixture({ wrapRuntimeDriver: driver => ({ ...driver,
      query: (statement, parameters) => Effect.andThen(Effect.sync(() => { statements.push(statement); }), driver.query(statement, parameters)),
    }) });
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, { ...options,
          indexCache: { maxBytes: 1024 * 1024, verifyPercent }, operationCacheMaxBytes: 1024 * 1024 });
        yield* activateCoreSchema(database, schema, publication);
        const writer = yield* database.begin();
        const created = yield* writer.insert("users", { name: "resident-boundary" });
        yield* database.commit(yield* writer.finalize());

        statements.length = 0;
        const first = yield* database.beginQuery(identity.functionPath);
        expect(first.program.identity).toEqual(identity);
        expect(statements).toEqual([]);
        expect(Option.getOrThrow(yield* first.transaction.get(created)).name).toBe("resident-boundary");
        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain("SELECT a.ts::text");
        statements.length = 0;
        yield* first.transaction.get(created);
        expect(statements).toEqual([]);
        yield* first.finish();

        const second = yield* database.beginQuery(identity.functionPath);
        expect(statements).toEqual([]);
        yield* second.transaction.get(created);
        expect(statements).toHaveLength(verifyPercent === 0 ? 0 : 1);
        expect(statements.every(statement => !statement.includes("persistence_globals"))).toBe(true);
        yield* second.finish();

        const old = yield* database.beginQuery(identity.functionPath);
        const replacement = { ...identity, programHash: "new-resident-program" };
        yield* database.publishPrograms({ programs: [{ identity: replacement, metadata: { artifact: "new-source" } }] });
        statements.length = 0;
        expect((yield* old.transaction.selectProgram(identity.functionPath)).identity).toEqual(identity);
        const fresh = yield* database.beginQuery(identity.functionPath);
        expect(fresh.program.identity).toEqual(replacement);
        expect(statements).toEqual([]);
        yield* old.finish();
        yield* fresh.finish();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it.each(["min_snapshot_ts", "document_min_snapshot_ts"])("refuses cold bootstrap below the durable %s floor", async floorName => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
      })));
      const maintenance = await fixture.reopen();
      await Effect.runPromise(Effect.gen(function* () {
        const lease = yield* maintenance.acquireLease();
        const timestamp = yield* maintenance.latestTimestamp(lease);
        yield* maintenance.putGlobal(lease, floorName, new TextEncoder().encode(String(timestamp + 1n)));
      }));
      const reopened = await fixture.reopen();
      const refused = await Effect.runPromise(Effect.result(Effect.scoped(openCoreDatabase(reopened, options))));
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "outOfRetention" });
    } finally { await fixture.close(); }
  }, 30_000);

  it("retains a predecessor until its successor leaves the window and keeps already-borrowed snapshots usable", async () => {
    const fixture = await createFixture();
    let now = 1_000_000_000n;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, { ...options, now: Effect.sync(() => now) });
        yield* activateCoreSchema(database, schema, publication);
        const installedAt = yield* database.publishedTimestamp;
        const borrowedBeforeInsert = yield* database.beginQuery(identity.functionPath);
        const writer = yield* database.begin();
        const created = yield* writer.insert("users", { name: "before-gap" });
        const insertedAt = yield* database.commit(yield* writer.finalize());

        now = 100_000_000_000n;
        const change = yield* database.begin();
        yield* change.patch(created, { name: "after-gap" });
        yield* database.commit(yield* change.finalize());
        const pruned = yield* Effect.result(database.begin({ at: installedAt }));
        expect(Result.isFailure(pruned) && pruned.failure).toMatchObject({ reason: "outOfRetention" });
        const exactPredecessor = yield* database.begin({ at: insertedAt });
        expect(Option.getOrThrow(yield* exactPredecessor.get(created)).name).toBe("before-gap");
        yield* exactPredecessor.abort();
        const between = yield* database.begin({ at: 50_000_000_000n });
        expect(Option.getOrThrow(yield* between.get(created)).name).toBe("before-gap");
        expect(Option.isNone(yield* borrowedBeforeInsert.transaction.get(created))).toBe(true);
        expect((yield* borrowedBeforeInsert.transaction.selectProgram(identity.functionPath)).identity).toEqual(identity);

        now = 111_000_000_000n;
        const later = yield* database.begin();
        yield* later.patch(created, { name: "latest" });
        yield* database.commit(yield* later.finalize());
        const oldPredecessor = yield* Effect.result(database.begin({ at: 50_000_000_000n }));
        expect(Result.isFailure(oldPredecessor) && oldPredecessor.failure).toMatchObject({ reason: "outOfRetention" });
        expect(Option.getOrThrow(yield* between.get(created)).name).toBe("before-gap");
        yield* between.abort();
        yield* borrowedBeforeInsert.finish();
      })));
    } finally { await fixture.close(); }
  }, 30_000);
  it("publishes resident row deltas with exact revisions while preserving old index roots and detached bytes", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
      })));
      await Effect.runPromise(Effect.gen(function* () {
        const lease = yield* fixture.persistence.acquireLease();
        const initial = yield* bootstrapCore(fixture.persistence, lease, options);
        const programs = initial.registry.table(PROGRAMS)?.definition;
        const head = initial.registry.head(identity.functionPath);
        const byIdentity = programs?.indexes.find(index => index.name === "by_identity");
        if (programs === undefined || head === undefined || byIdentity === undefined) throw new Error("Missing resident program index");
        const request = { index: byIdentity.ref, tableId: programs.tabletId, interval: { start: null, end: null },
          order: "asc" as const, maxResults: 128 };
        const before = initial.resident.scan(request);
        const oldEntry = before?.entries.find(entry => bytesEqual(entry.document.id, head.id));
        if (before === undefined || oldEntry === undefined) throw new Error("Missing resident head revision");
        const oldDocument = Result.getOrThrow(readDocumentObject(oldEntry.document, programs));
        const replacement = { ...identity, programHash: "changed-head-key" };
        const revision: CoreDocumentLogEntry = { ...oldEntry.document, ts: initial.timestamp + 1n, prevTs: oldEntry.document.ts,
          jsonValue: Result.getOrThrow(encodeDocumentValue({ ...oldDocument, identity: replacement })) };
        const next = yield* Effect.fromResult(initial.resident.apply(initial.registry.withHead({ ...head,
          identity: replacement, ts: revision.ts }), [revision]));
        const after = next.scan(request);
        const newEntry = after?.entries.find(entry => bytesEqual(entry.document.id, head.id));
        if (after === undefined || newEntry === undefined) throw new Error("Missing updated resident head revision");
        expect(after.entries).toHaveLength(before.entries.length);
        expect(newEntry.key).not.toEqual(oldEntry.key);
        expect(newEntry.document.ts).toBe(revision.ts);
        expect(newEntry.document.prevTs).toBe(oldEntry.document.ts);
        expect(Result.getOrThrow(readDocumentObject(newEntry.document, programs)).identity).toEqual(replacement);
        expect(Result.getOrThrow(readDocumentObject(oldEntry.document, programs)).identity).toEqual(identity);
        revision.jsonValue.fill(0);
        oldEntry.document.jsonValue.fill(0);
        const oldAgain = initial.resident.scan(request)?.entries.find(entry => bytesEqual(entry.document.id, head.id));
        const newAgain = next.scan(request)?.entries.find(entry => bytesEqual(entry.document.id, head.id));
        if (oldAgain === undefined || newAgain === undefined) throw new Error("Resident roots lost their revision");
        expect(Result.getOrThrow(readDocumentObject(oldAgain.document, programs)).identity).toEqual(identity);
        expect(Result.getOrThrow(readDocumentObject(newAgain.document, programs)).identity).toEqual(replacement);
      }));
    } finally { await fixture.close(); }
  }, 30_000);
  it("packs admitted nested validators while retaining the document nesting limit and cold schema enforcement", async () => {
    const fixture = await createFixture();
    let validator: ValidatorJsonV1 = { type: "string" };
    let value: DocumentValue = "leaf";
    for (let depth = 0; depth < 5; depth += 1) {
      validator = { type: "object", value: { child: { fieldType: validator, optional: false } } };
      value = { child: value };
    }
    const expectedDocument = Result.getOrThrow(captureDocumentObject(value));
    const nestedSchema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true,
      tables: [{ tableName: "users", documentType: validator, indexes: [] }] }));
    let created = "";
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, nestedSchema);
        const transaction = yield* database.begin();
        created = yield* transaction.insert("users", expectedDocument);
        yield* database.commit(yield* transaction.finalize());
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        const transaction = yield* database.begin();
        expect(Option.getOrThrow(yield* transaction.get(created))).toMatchObject(expectedDocument);
        const refused = yield* Effect.result(transaction.insert("users", { child: 42 }));
        expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "documentValidation" });
        yield* transaction.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("packs general program metadata through nesting64 and reconstructs the exact metadata on cold reopen", async () => {
    const fixture = await createFixture();
    let metadata: DocumentObject = { bigint: 9n, bytes: Uint8Array.of(1, 2, 255).buffer };
    for (let depth = 1; depth < 64; depth += 1) metadata = { child: metadata };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.publishPrograms({ programs: [{ identity, metadata }] });
        expect((yield* database.selectProgram(identity.functionPath)).metadata).toEqual(metadata);
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        expect((yield* database.lookupProgram(identity)).metadata).toEqual(metadata);
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("strictly rejects malformed packed validators and program metadata during cold reconstruction", async () => {
    const fixture = await createFixture();
    const records = new Map<string, Readonly<{ entry: CoreDocumentLogEntry; document: DocumentObject }>>();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          for (const entry of batch.documents) {
            if (entry.deleted) continue;
            const document = Result.getOrThrow(readDocumentObject(entry));
            if (typeof document.schema === "string") records.set("schema", { entry, document });
            if (document.kind === "revision") records.set("metadata", { entry, document });
          }
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
      })));
      for (const [field, malformed] of [
        ["schema", ["{", '{"tables":[{"tableName":"users","indexes":[],"documentType":{"type":"unsupported"}}]}', { type: "any" }, undefined]],
        ["metadata", ["{", "42", { artifact: "raw-object" }, undefined]],
      ] as const) {
        const record = records.get(field);
        if (record === undefined) throw new Error(`Missing observed ${field} record`);
        for (const packed of malformed) {
          const base = Object.fromEntries(Object.entries(record.document).filter(([name]) => name !== field));
          const corruption = packed === undefined ? base : { ...base, [field]: packed };
          const bytes = Result.getOrThrow(encodeDocumentValue(corruption));
          await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [bytes, fixture.instanceName, record.entry.tableId, record.entry.id, record.entry.ts.toString()]);
          const reopened = await fixture.reopen();
          const restored = await Effect.runPromise(Effect.scoped(Effect.result(Effect.gen(function* () {
            const database = yield* openCoreDatabase(reopened, options);
            // Source unique-state metadata parses its schema lazily. Admission
            // must refuse malformed active validators before any data is staged.
            const transaction = yield* database.begin();
            yield* transaction.insert("users", { name: "corrupt-schema-check" });
            yield* transaction.abort();
          }))));
          expect(Result.isFailure(restored) && restored.failure).toMatchObject({ reason: "corruptData" });
          await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [record.entry.jsonValue, fixture.instanceName, record.entry.tableId, record.entry.id, record.entry.ts.toString()]);
        }
      }
    } finally { await fixture.close(); }
  }, 30_000);

  it("packs general-value results without adding document nesting and preserves exact types on cold replay", async () => {
    const fixture = await createFixture();
    const expected: Array<Readonly<{ key: string; value: DocumentValue }>> = [];
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        for (const depth of [16, 32, 64]) {
          let value: DocumentValue = { bigint: -9_223_372_036_854_775_808n, negativeZero: -0, nan: Number.NaN,
            infinity: Number.POSITIVE_INFINITY, bytes: Uint8Array.of(0, 1, 128, 255).buffer };
          for (let nesting = 1; nesting < depth; nesting += 1) value = { child: value };
          const captured = Result.getOrThrow(captureDocumentValue(value));
          const key = `packed-depth-${depth}`;
          expected.push({ key, value: captured });
          const acquisition = yield* database.claimRequest({ key, requestHash: key, program: identity });
          if (acquisition.kind !== "claimed") throw new Error("Expected request claim");
          const transaction = yield* database.begin({ claim: acquisition.claim });
          yield* database.commit(yield* transaction.finalize(), { claim: acquisition.claim, result: captured });
          const warm = yield* database.resolveRequest({ key, requestHash: key, program: identity });
          if (warm.kind !== "committed") throw new Error("Expected committed packed result");
          expect(warm.result).toEqual(captured);
        }
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        for (const result of expected) {
          const replayed = yield* database.recoverRequest({ key: result.key, requestHash: result.key, program: identity });
          if (replayed.kind !== "committed") throw new Error("Expected committed packed replay");
          expect(replayed.result).toEqual(result.value);
        }
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("rejects malformed, missing and non-string packed outcomes after fenced reconstruction", async () => {
    const fixture = await createFixture();
    const request = { key: "corrupt-packed-result", requestHash: "packed-request", program: identity };
    let stored: CoreDocumentLogEntry | undefined;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let observeOutcome = false;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          if (observeOutcome) {
            expect(batch.documents).toHaveLength(1);
            stored = batch.documents[0];
          }
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const acquisition = yield* database.claimRequest(request);
        if (acquisition.kind !== "claimed") throw new Error("Expected request claim");
        const transaction = yield* database.begin({ claim: acquisition.claim });
        observeOutcome = true;
        yield* database.commit(yield* transaction.finalize(), { claim: acquisition.claim, result: "valid-result" });
      })));
      const entry = stored;
      if (entry === undefined) throw new Error("Missing observed outcome revision");
      const document = Result.getOrThrow(readDocumentObject(entry));
      const corruptions = [
        { ...document, result: "{" },
        { ...document, result: '{"$integer":"invalid-base64"}' },
        { ...document, result: 42 },
        Object.fromEntries(Object.entries(document).filter(([name]) => name !== "result")),
      ];
      // SQL maintenance runs only after the serving scope is closed. Every
      // malformed revision is then read through a newly fenced owner.
      for (const corruption of corruptions) {
        const bytes = Result.getOrThrow(encodeDocumentValue(corruption));
        await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
          WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
        [bytes, fixture.instanceName, entry.tableId, entry.id, entry.ts.toString()]);
        const reopened = await fixture.reopen();
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(reopened, options);
          const resolution = yield* Effect.result(database.resolveRequest(request));
          expect(Result.isFailure(resolution) && resolution.failure).toMatchObject({ reason: "corruptData" });
          const recovery = yield* Effect.result(database.recoverRequest(request));
          expect(Result.isFailure(recovery) && recovery.failure).toMatchObject({ reason: "corruptData" });
        })));
      }
    } finally { await fixture.close(); }
  }, 30_000);
  it("refuses public metadata writes and tracks absent table numbers through the live mapping", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const activation = yield* activateCoreSchema(database, schema, publication);
        const proposal = yield* database.prepareSchema({ schema });
        const originalStatus = yield* database.schemaStatus(proposal);
        const originalTimestamp = yield* database.publishedTimestamp;
        const rejected = yield* database.begin();
        const refusal = yield* Effect.result(rejected.insert("_schemas", {
          state: { state: "active" }, schema: '{"tables":[],"schemaValidation":true}',
        }));
        expect(Result.isFailure(refusal) && refusal.failure).toMatchObject({ reason: "invalidValue" });
        expect((yield* rejected.usage).user.documentsWritten).toBe(0);
        expect((yield* rejected.usage).system.documentsWritten).toBe(0);
        yield* database.commit(yield* rejected.finalize());
        expect(yield* database.publishedTimestamp).toBe(originalTimestamp);
        expect(yield* database.schemaStatus(proposal)).toEqual(originalStatus);

        const absent = yield* database.begin();
        const missingNumber = Math.max(...activation.tables.map(table => table.number)) + 1;
        const missingId = Result.getOrThrow(encodeDocumentId(missingNumber, id(200)));
        expect(Option.isNone(yield* absent.get(missingId))).toBe(true);
        yield* absent.insert("users", { name: "depends-on-missing-table" });
        const absentSnapshot = yield* absent.finalize();
        const creator = yield* database.begin();
        yield* creator.insert("new_table", { value: "implicit" });
        yield* database.commit(yield* creator.finalize());
        const changedMapping = yield* Effect.result(database.commit(absentSnapshot));
        expect(Result.isFailure(changedMapping) && changedMapping.failure).toMatchObject({ reason: "conflict" });

        // A trusted new component namespace can write before it has a schema
        // table. Its absent schema records a mapping dependency, not a defect.
        const namespace = { kind: "byComponent" as const, id: Result.getOrThrow(encodeDocumentId(missingNumber, id(201))) };
        const child = yield* database.begin({ namespace });
        const created = yield* child.insert("fresh_child", { value: "no-schema-yet" });
        yield* database.commit(yield* child.finalize());
        const childReader = yield* database.begin({ namespace });
        expect(Option.getOrThrow(yield* childReader.get(created)).value).toBe("no-schema-yet");
        yield* childReader.abort();
        expect(yield* database.schemaStatus(proposal)).toEqual(originalStatus);
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("classifies only pre-stage document validator refusals and permits a caught refusal followed by valid writes", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const transaction = yield* database.begin();
        const invalidInsert = yield* Effect.result(transaction.insert("users", { name: 42 }));
        expect(Result.isFailure(invalidInsert) && invalidInsert.failure).toMatchObject({ reason: "documentValidation",
          cause: { _tag: "ValidatorValueErrorV1" } });
        expect((yield* transaction.usage).user.documentsWritten).toBe(0);
        const created = yield* transaction.insert("users", { name: "valid", padding: "preserved" });
        const invalidPatch = yield* Effect.result(transaction.patch(created, { name: false }));
        expect(Result.isFailure(invalidPatch) && invalidPatch.failure).toMatchObject({ reason: "documentValidation" });
        const invalidReplace = yield* Effect.result(transaction.replace(created, { padding: "missing-required-name" }));
        expect(Result.isFailure(invalidReplace) && invalidReplace.failure).toMatchObject({ reason: "documentValidation" });
        const managedField = yield* Effect.result(transaction.insert("users", { name: "invalid-managed-field", _id: created }));
        expect(Result.isFailure(managedField) && managedField.failure).toMatchObject({ reason: "invalidValue" });
        yield* transaction.patch(created, { name: "valid-after-catch" });
        expect((yield* transaction.usage).user.documentsWritten).toBe(2);
        yield* database.commit(yield* transaction.finalize());
        const reader = yield* database.begin();
        expect(Option.getOrThrow(yield* reader.get(created))).toMatchObject({ name: "valid-after-catch", padding: "preserved" });
        expect((yield* reader.scan("users", "by_name"))).toMatchObject([{ _id: created, name: "valid-after-catch" }]);
        yield* reader.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("refuses a finalized request whose signed admission deadline expires while waiting for acceptance", async () => {
    const fixture = await createFixture();
    const request = { key: "expires-before-acceptance", requestHash: "deadline-request", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const waiting = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let pause = false;
        let wallTime = 1_000;
        const liveClock = yield* Effect.clockWith(clock => Effect.succeed(clock));
        const clock: Clock.Clock = { currentTimeMillisUnsafe: () => wallTime,
          currentTimeMillis: Effect.sync(() => wallTime), currentTimeNanosUnsafe: () => liveClock.currentTimeNanosUnsafe(),
          currentTimeNanos: liveClock.currentTimeNanos, monotonicTimeNanosUnsafe: () => liveClock.monotonicTimeNanosUnsafe(),
          monotonicTimeNanos: liveClock.monotonicTimeNanos, sleep: duration => liveClock.sleep(duration) };
        const database = yield* openCoreDatabase(fixture.persistence, { ...options, now: Effect.gen(function* () {
          if (pause) { pause = false; yield* Deferred.succeed(waiting, undefined); yield* Deferred.await(release); }
          return 1_000_000_000n;
        }) });
        yield* activateCoreSchema(database, schema, publication);
        const acquisition = yield* database.claimRequest(request);
        if (acquisition.kind !== "claimed") throw new Error("Expected request claim");
        const transaction = yield* database.begin({ claim: acquisition.claim });
        yield* transaction.insert("users", { name: "must-not-persist" });
        const finalized = yield* transaction.finalize();
        const commitOptions = { claim: acquisition.claim, result: "must-not-persist", admissionDeadlineUnixMilliseconds: 1_500 };
        pause = true;
        const committing = yield* Effect.forkChild(Effect.result(database.commit(finalized, commitOptions)
          .pipe(Effect.provideService(Clock.Clock, clock))));
        yield* Deferred.await(waiting);
        wallTime = 1_500;
        // Caller mutation after admission starts cannot extend the captured signed deadline.
        commitOptions.admissionDeadlineUnixMilliseconds = 2_500;
        yield* Deferred.succeed(release, undefined);
        const committed = yield* Fiber.join(committing);
        expect(Result.isFailure(committed) && committed.failure).toMatchObject({ reason: "admissionExpired" });
        expect(yield* database.resolveRequest(request)).toEqual({ kind: "busy" });
        const reader = yield* database.begin();
        expect(yield* reader.scan("users", "by_name")).toEqual([]);
        yield* reader.abort();
        yield* database.abortRequest(acquisition.claim);
        expect(yield* database.resolveRequest(request)).toEqual({ kind: "failed" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("recovers a commit admitted before expiry after its acknowledgement is lost beyond the deadline", async () => {
    const fixture = await createFixture();
    const request = { key: "expires-after-acceptance", requestHash: "accepted-request", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const saved = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let loseAck = false;
        let wallTime = 1_000;
        const liveClock = yield* Effect.clockWith(clock => Effect.succeed(clock));
        const clock: Clock.Clock = { currentTimeMillisUnsafe: () => wallTime,
          currentTimeMillis: Effect.sync(() => wallTime), currentTimeNanosUnsafe: () => liveClock.currentTimeNanosUnsafe(),
          currentTimeNanos: liveClock.currentTimeNanos, monotonicTimeNanosUnsafe: () => liveClock.monotonicTimeNanosUnsafe(),
          monotonicTimeNanos: liveClock.monotonicTimeNanos, sleep: duration => liveClock.sleep(duration) };
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          if (loseAck) {
            yield* Deferred.succeed(saved, undefined);
            yield* Deferred.await(release);
            return yield* Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
          }
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const acquisition = yield* database.claimRequest(request);
        if (acquisition.kind !== "claimed") throw new Error("Expected request claim");
        const transaction = yield* database.begin({ claim: acquisition.claim });
        yield* transaction.insert("users", { name: "admitted-before-expiry" });
        const finalized = yield* transaction.finalize();
        loseAck = true;
        const committing = yield* Effect.forkChild(Effect.result(database.commit(finalized, { claim: acquisition.claim,
          result: "durable-before-expiry", admissionDeadlineUnixMilliseconds: 1_500,
        }).pipe(Effect.provideService(Clock.Clock, clock))));
        yield* Deferred.await(saved);
        wallTime = 2_000;
        yield* Deferred.succeed(release, undefined);
        const committed = yield* Fiber.join(committing);
        expect(Result.isFailure(committed) && committed.failure).toMatchObject({ reason: "uncertainWrite" });
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        expect(yield* database.recoverRequest(request)).toMatchObject({ kind: "committed", result: "durable-before-expiry" });
        const reader = yield* database.begin();
        expect((yield* reader.scan("users", "by_name"))).toMatchObject([{ name: "admitted-before-expiry" }]);
        yield* reader.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("conflicts old-snapshot writes with a schema proposal and backfills populated index evolution", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const initial = yield* activateCoreSchema(database, schema, publication);
        const previousTable = initial.tables.find(table => table.name === "users");
        if (previousTable === undefined) throw new Error("Missing activated users table");
        const stale = yield* database.begin();
        const rejectedId = yield* stale.insert("users", { name: "stale-schema", padding: "must-not-persist" });
        const staleFinalized = yield* stale.finalize();
        const changed = { ...schema, tables: schema.tables.map(table => ({ ...table,
          indexes: [...table.indexes, { indexDescriptor: "by_padding", fields: ["padding", "_creationTime"] }],
        })) };
        const proposal = yield* database.prepareSchema({ schema: changed });
        const conflicted = yield* Effect.result(database.commit(staleFinalized));
        expect(Result.isFailure(conflicted) && conflicted.failure).toMatchObject({ reason: "conflict" });
        const inserting = yield* database.begin();
        const created = yield* inserting.insert("users", { name: "inserted-during-build", padding: "indexed-later" });
        yield* database.commit(yield* inserting.finalize());
        const pending = yield* database.begin();
        const unreadable = yield* Effect.result(pending.scan("users", "by_padding"));
        expect(Result.isFailure(unreadable) && unreadable.failure).toMatchObject({ reason: "indexUnavailable" });
        yield* pending.abort();
        const activated = yield* activateCoreSchema(database, changed);
        expect((yield* database.schemaStatus(proposal)).state).toBe("active");
        const currentTable = activated.tables.find(table => table.name === "users");
        expect(currentTable?.number).toBe(previousTable.number);
        expect(currentTable?.tabletId).toEqual(previousTable.tabletId);
        const reader = yield* database.begin();
        expect(yield* reader.scan("users", "by_padding")).toMatchObject([{ _id: created, padding: "indexed-later" }]);
        expect(Option.isNone(yield* reader.get(rejectedId))).toBe(true);
        yield* reader.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);
  it("indexes only own fields for absent prototype names and nested accepted object keys", async () => {
    const fixture = await createFixture();
    const fields = ["toString", "constructor", "hasOwnProperty", "nested.toString", "nested.constructor",
      "nested.hasOwnProperty", "nested.__proto__.toString"];
    const stringValidator: ValidatorJsonV1 = { type: "string" };
    const special = { schemaValidation: true, tables: [{ tableName: "users",
      documentType: { type: "object", value: {
        name: { fieldType: stringValidator, optional: false },
        toString: { fieldType: stringValidator, optional: true },
        constructor: { fieldType: stringValidator, optional: true },
        hasOwnProperty: { fieldType: stringValidator, optional: true },
        nested: { fieldType: { type: "object", value: {
          toString: { fieldType: stringValidator, optional: true },
          constructor: { fieldType: stringValidator, optional: true },
          hasOwnProperty: { fieldType: stringValidator, optional: true },
          ["__proto__"]: { fieldType: { type: "object", value: {
            toString: { fieldType: stringValidator, optional: false },
          } }, optional: true },
        } }, optional: true },
      } }, indexes: fields.map((field, index) => ({ indexDescriptor: `special_${index}`,
        fields: [field, "_creationTime"] })),
    }] };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, special);
        const transaction = yield* database.begin();
        const absent = yield* transaction.insert("users", { name: "absent", nested: {} });
        const present = yield* transaction.insert("users", { name: "present", toString: "own-top",
          constructor: "own-constructor", hasOwnProperty: "own-check", nested: { toString: "own-nested",
            constructor: "own-nested-constructor", hasOwnProperty: "own-nested-check",
            ["__proto__"]: { toString: "own-proto-value" },
          } });
        yield* database.commit(yield* transaction.finalize());
        const reader = yield* database.begin();
        for (let index = 0; index < fields.length; index += 1) {
          const rows = yield* reader.scan("users", `special_${index}`);
          expect(rows.map(row => row._id)).toEqual([absent, present]);
        }
        const document = Option.getOrThrow(yield* reader.get(present));
        expect(document.nested).toEqual({ toString: "own-nested", constructor: "own-nested-constructor",
          hasOwnProperty: "own-nested-check", ["__proto__"]: { toString: "own-proto-value" } });
        yield* reader.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("retains live old snapshots and rejects cold metadata history while physical revisions remain readable", async () => {
    const fixture = await createFixture({ sqlPageSize: 2 });
    let created = "";
    let oldTimestamp = 0n;
    let activatedTable: CoreTableDefinition | undefined;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        activatedTable = (yield* activateCoreSchema(database, schema, publication)).tables.find(table => table.name === "users");
        const transaction = yield* database.begin({ program: identity, authorityEpoch: 1n });
        created = yield* transaction.insert("users", { name: "same", padding: "before" });
        oldTimestamp = yield* database.commit(yield* transaction.finalize());
        const changed = yield* database.begin();
        yield* changed.patch(created, { padding: "after" });
        yield* database.commit(yield* changed.finalize());
        const current = yield* database.begin();
        expect((yield* current.scan("users", "by_name"))).toMatchObject([{ _id: created, padding: "after" }]);
        yield* current.abort();
        const older = yield* database.begin({ at: oldTimestamp });
        expect(Option.getOrThrow(yield* older.get(created)).padding).toBe("before");
        expect((yield* older.scan("users", "by_name"))).toMatchObject([{ padding: "before" }]);
        yield* older.abort();
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        const beforeReplay = yield* database.publishedTimestamp;
        yield* activateCoreSchema(database, schema, publication);
        expect(yield* database.publishedTimestamp).toBe(beforeReplay);
        expect((yield* database.selectProgram(identity.functionPath)).metadata.artifact).toBe("immutable-source");
        expect(yield* database.readAuthorityEpoch).toBe(1n);
        const refused = yield* Effect.result(database.begin({ at: oldTimestamp }));
        expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "outOfRetention" });
        const physical = yield* reopened.readSnapshot(oldTimestamp);
        const byName = activatedTable?.indexes.find(index => index.name === "by_name");
        if (activatedTable === undefined || byName === undefined) throw new Error("Missing retained physical table/index binding");
        const page = yield* physical.scan({ index: byName.ref, tableId: activatedTable.tabletId,
          interval: { start: null, end: null }, order: "asc", maxResults: 128 });
        expect(page.entries).toHaveLength(1);
        const row = page.entries[0];
        if (row === undefined) throw new Error("Expected retained historical physical revision");
        expect(yield* Effect.fromResult(readDocumentObject(row.document))).toMatchObject({ padding: "before" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("keeps request claims/outcomes and terminal failure in logical revisions", async () => {
    const fixture = await createFixture();
    const request = { key: "request-one", requestHash: "request-hash", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const acquired = yield* database.claimRequest(request);
        if (acquired.kind !== "claimed") throw new Error("Expected fresh claim");
        const transaction = yield* database.begin({ claim: acquired.claim, authorityEpoch: 1n });
        yield* database.commit(yield* transaction.finalize(), { claim: acquired.claim, result: "only-outcome" });
        expect(yield* database.resolveRequest({ ...request, program: { ...identity, programHash: "program-b" } }))
          .toMatchObject({ kind: "committed", result: "only-outcome" });
        const aborted = yield* database.claimRequest({ ...request, key: "request-two" });
        if (aborted.kind !== "claimed") throw new Error("Expected fresh second claim");
        yield* database.abortRequest(aborted.claim);
        expect(yield* database.resolveRequest({ ...request, key: "request-two" })).toEqual({ kind: "failed" });
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        expect(yield* database.resolveRequest(request)).toMatchObject({ kind: "committed", result: "only-outcome" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("refuses foreign/consumed finalization and actual revoked authority while retaining old code", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const foreign = yield* Effect.result(database.commit(issueFinalizedTransaction()));
        expect(Result.isFailure(foreign) && foreign.failure).toMatchObject({ reason: "foreignFinalization" });
        const transaction = yield* database.begin({ program: identity, authorityEpoch: 1n });
        yield* transaction.insert("users", { name: "original" });
        yield* database.publishPrograms({ programs: [{ identity: { ...identity, programHash: "program-b" }, metadata: {} }] });
        expect((yield* database.lookupProgram(identity)).identity.programHash).toBe("program-a");
        const conflict = yield* Effect.result(database.commit(yield* transaction.finalize()));
        expect(Result.isFailure(conflict) && conflict.failure).toMatchObject({ reason: "conflict" });
        const retry = yield* database.begin({ program: identity, authorityEpoch: 1n });
        yield* retry.insert("users", { name: "after-head" });
        yield* database.commit(yield* retry.finalize());
        const beforeRevocation = yield* database.begin({ program: identity, authorityEpoch: 1n });
        yield* beforeRevocation.insert("users", { name: "revoked" });
        yield* database.advanceAuthorityEpoch(2n);
        const revoked = yield* Effect.result(database.commit(yield* beforeRevocation.finalize()));
        expect(Result.isFailure(revoked) && revoked.failure).toMatchObject({ reason: "conflict" });
        const admission = yield* Effect.result(database.begin({ program: identity, authorityEpoch: 1n }));
        expect(Result.isFailure(admission) && admission.failure).toMatchObject({ reason: "authorityRevoked" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("checks accepted unsaved conflicts before persistence and preserves batch uncertainty", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          if (pause) { pause = false; yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
          yield* fixture.persistence.write(lease, batch);
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const seed = yield* database.begin();
        const created = yield* seed.insert("users", { name: "seed" });
        yield* database.commit(yield* seed.finalize());
        const first = yield* database.begin();
        const second = yield* database.begin();
        yield* first.patch(created, { name: "first" });
        yield* second.patch(created, { name: "second" });
        pause = true;
        const saving = yield* Effect.forkChild(database.commit(yield* first.finalize()));
        yield* Deferred.await(started);
        const conflict = yield* Effect.result(database.commit(yield* second.finalize()));
        expect(Result.isFailure(conflict) && conflict.failure).toMatchObject({ reason: "conflict" });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(saving);
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("resolves only matching accepted-unsaved request claims as busy without issuing another body", async () => {
    const fixture = await createFixture();
    const request = { key: "pending-claim", requestHash: "authenticated-request", program: identity };
    const otherProgram = { ...identity, functionPath: "users:other" };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let pause = false;
        let saves = 0;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          if (pause) { pause = false; saves += 1; yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
          yield* fixture.persistence.write(lease, batch);
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, { ...publication,
          programs: [...publication.programs, { identity: otherProgram, metadata: {} }] });
        pause = true;
        const acquiring = yield* Effect.forkChild(database.claimRequest(request));
        yield* Deferred.await(started);
        yield* Effect.ensuring(Effect.gen(function* () {
          expect(yield* database.claimRequest(request)).toEqual({ kind: "busy" });
          const wrongHash = yield* Effect.result(database.claimRequest({ ...request, requestHash: "other-arguments" }));
          expect(Result.isFailure(wrongHash) && wrongHash.failure).toMatchObject({ reason: "requestMismatch" });
          const wrongPath = yield* Effect.result(database.claimRequest({ ...request, program: otherProgram }));
          expect(Result.isFailure(wrongPath) && wrongPath.failure).toMatchObject({ reason: "requestMismatch" });
          // Pending discovery never promotes an unpublished claim to durable resolution.
          expect(yield* database.resolveRequest(request)).toEqual({ kind: "missing" });
          expect(saves).toBe(1);
        }), Deferred.succeed(release, undefined));
        const original = yield* Fiber.join(acquiring);
        if (original.kind !== "claimed") throw new Error("Expected only the original body claim");
        expect(yield* database.claimRequest(request)).toEqual({ kind: "busy" });
        const transaction = yield* database.begin({ claim: original.claim });
        yield* database.commit(yield* transaction.finalize(), { claim: original.claim, result: "one-body" });
        expect(yield* database.claimRequest(request)).toMatchObject({ kind: "committed", result: "one-body" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("stops admission after a lost acknowledgement and recovers the stored outcome on cold reopen", async () => {
    const fixture = await createFixture();
    const request = { key: "uncertain", requestHash: "same-request", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let loseAck = false;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          if (loseAck) return yield* Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const acquisition = yield* database.claimRequest(request);
        if (acquisition.kind !== "claimed") throw new Error("Expected claim");
        const transaction = yield* database.begin({ claim: acquisition.claim });
        loseAck = true;
        const result = yield* Effect.result(database.commit(yield* transaction.finalize(), { claim: acquisition.claim, result: "durable" }));
        expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "uncertainWrite" });
        expect(Result.isFailure(yield* Effect.result(database.begin()))).toBe(true);
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        expect(yield* database.recoverRequest(request)).toMatchObject({ kind: "committed", result: "durable" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("merges independent accepted metadata deltas without losing either published registry", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const secondSaved = yield* Deferred.make<void>();
        let delayed = false;
        let writes = 0;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          if (delayed) {
            writes += 1;
            if (writes === 1) { yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
          }
          yield* fixture.persistence.write(lease, batch);
          if (delayed && writes === 2) yield* Deferred.succeed(secondSaved, undefined);
        }) };
        const database = yield* openCoreDatabase(persistence, { ...options, maxConcurrentSaves: 2, batchWriteThreshold: 2 });
        const activation = yield* activateCoreSchema(database, schema, publication);
        const users = activation.tables.find(table => table.name === "users");
        if (users === undefined) throw new Error("Missing activated users table");
        delayed = true;
        const installingAlpha = yield* Effect.forkChild(database.publishPrograms({ programs: [{ identity: {
          ...identity, functionPath: "alpha:query",
        }, metadata: { owner: "alpha" } }] }));
        yield* Deferred.await(started);
        const collision = yield* Effect.result(database.publishPrograms({ programs: [{ identity: {
          ...identity, functionPath: "alpha:query", programHash: "collision",
        }, metadata: {} }] }));
        expect(Result.isFailure(collision) && collision.failure).toMatchObject({ reason: "conflict" });
        const installingBeta = yield* Effect.forkChild(database.publishPrograms({ programs: [{ identity: {
          ...identity, functionPath: "beta:query",
        }, metadata: { owner: "beta" } }] }));
        yield* Deferred.await(secondSaved);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(installingAlpha);
        yield* Fiber.join(installingBeta);
        expect((yield* database.selectProgram("alpha:query")).metadata.owner).toBe("alpha");
        expect((yield* database.selectProgram("beta:query")).metadata.owner).toBe("beta");
        const transaction = yield* database.begin();
        expect(yield* transaction.tableNumber("users")).toBe(users.number);
        yield* transaction.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("reconciles every logical outcome after a grouped write loses its acknowledgement", async () => {
    const fixture = await createFixture();
    const firstRequest = { key: "group-one", requestHash: "group-hash-one", program: identity };
    const secondRequest = { key: "group-two", requestHash: "group-hash-two", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let loseAck = false;
        let groupedDocuments = 0;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          if (loseAck) {
            groupedDocuments = batch.documents.length;
            return yield* Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
          }
        }) };
        const database = yield* openCoreDatabase(persistence, { ...options, maxBatchDelayMilliseconds: 10 });
        yield* activateCoreSchema(database, schema, publication);
        const first = yield* database.claimRequest(firstRequest);
        const second = yield* database.claimRequest(secondRequest);
        if (first.kind !== "claimed" || second.kind !== "claimed") throw new Error("Expected independent claims");
        const firstTransaction = yield* database.begin({ claim: first.claim });
        const secondTransaction = yield* database.begin({ claim: second.claim });
        const firstFinal = yield* firstTransaction.finalize();
        const secondFinal = yield* secondTransaction.finalize();
        loseAck = true;
        const outcomes = yield* Effect.all([
          Effect.result(database.commit(firstFinal, { claim: first.claim, result: "one" })),
          Effect.result(database.commit(secondFinal, { claim: second.claim, result: "two" })),
        ], { concurrency: 2 });
        expect(outcomes.every(Result.isFailure)).toBe(true);
        expect(groupedDocuments).toBe(2);
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        const first = yield* database.recoverRequest(firstRequest);
        const second = yield* database.recoverRequest(secondRequest);
        expect(first).toMatchObject({ kind: "committed", result: "one" });
        expect(second).toMatchObject({ kind: "committed", result: "two" });
        expect(first.kind === "committed" && second.kind === "committed" && first.timestamp < second.timestamp).toBe(true);
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("refuses finalization during an owned read and closes every later capability", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (at, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(at, retention);
          return { ...snapshot, scan: request => Effect.gen(function* () {
            if (pause) { pause = false; yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
            return yield* snapshot.scan(request);
          }) };
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const seed = yield* database.begin();
        const created = yield* seed.insert("users", { name: "seed" });
        yield* database.commit(yield* seed.finalize());
        const transaction = yield* database.begin();
        pause = true;
        const reading = yield* Effect.forkChild(transaction.get(created));
        yield* Deferred.await(started);
        const premature = yield* Effect.result(transaction.finalize());
        expect(Result.isFailure(premature) && premature.failure).toMatchObject({ reason: "inflight" });
        yield* Deferred.succeed(release, undefined);
        expect(Option.getOrThrow(yield* Fiber.join(reading)).name).toBe("seed");
        const finalized = yield* transaction.finalize();
        expect(Result.isFailure(yield* Effect.result(transaction.patch(created, { name: "late" })))).toBe(true);
        expect(Result.isFailure(yield* Effect.result(transaction.finalize()))).toBe(true);
        yield* database.commit(finalized);
        const repeated = yield* Effect.result(database.commit(finalized));
        expect(Result.isFailure(repeated) && repeated.failure).toMatchObject({ reason: "foreignFinalization" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("recovers only predecessor claims as terminal failure and never rebinds body authority", async () => {
    const fixture = await createFixture();
    const request = { key: "abandoned", requestHash: "original-request", program: identity };
    let oldClaim: CoreRequestClaim | undefined;
    let oldFinalized: CoreFinalizedTransaction | undefined;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const acquired = yield* database.claimRequest(request);
        if (acquired.kind !== "claimed") throw new Error("Expected claim");
        oldClaim = acquired.claim;
        expect(yield* database.recoverRequest(request)).toEqual({ kind: "busy" });
        const wrongProgram = yield* Effect.result(database.begin({ claim: acquired.claim,
          program: { ...identity, schemaHash: "other-schema" } }));
        expect(Result.isFailure(wrongProgram) && wrongProgram.failure).toMatchObject({ reason: "requestMismatch" });
        const transaction = yield* database.begin({ claim: acquired.claim });
        oldFinalized = yield* transaction.finalize();
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        const mismatch = yield* Effect.result(database.recoverRequest({ ...request, requestHash: "different-arguments" }));
        expect(Result.isFailure(mismatch) && mismatch.failure).toMatchObject({ reason: "requestMismatch" });
        expect(yield* database.resolveRequest(request)).toEqual({ kind: "busy" });
        expect(yield* database.recoverRequest({ ...request, program: { ...identity, programHash: "new-head" } })).toEqual({ kind: "failed" });
        expect(yield* database.recoverRequest(request)).toEqual({ kind: "failed" });
        if (oldClaim === undefined || oldFinalized === undefined) throw new Error("Missing predecessor evidence");
        expect(Result.isFailure(yield* Effect.result(database.begin({ claim: oldClaim })))).toBe(true);
        expect(Result.isFailure(yield* Effect.result(database.commit(oldFinalized, { claim: oldClaim })))).toBe(true);
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("serializes overlapping patches within one transaction without losing either field", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (at, retention) => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(at, retention);
          return { ...snapshot, scan: request => Effect.gen(function* () {
            if (pause) { pause = false; yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
            return yield* snapshot.scan(request);
          }) };
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* activateCoreSchema(database, schema, publication);
        const seed = yield* database.begin();
        const created = yield* seed.insert("users", { name: "before", padding: "before" });
        yield* database.commit(yield* seed.finalize());
        const transaction = yield* database.begin();
        pause = true;
        const first = yield* Effect.forkChild(transaction.patch(created, { name: "after" }));
        yield* Deferred.await(started);
        const second = yield* Effect.forkChild(transaction.patch(created, { padding: "after" }));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        expect(Option.getOrThrow(yield* transaction.get(created))).toMatchObject({ name: "after", padding: "after" });
        expect((yield* transaction.usage).user.documentsWritten).toBe(2);
        yield* database.commit(yield* transaction.finalize());
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("charges repeated cached reads and coalesced edits per call using semantic document sizes", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, { ...options, transactionLimits: { documentsWritten: 2 } });
        yield* activateCoreSchema(database, schema, publication);
        const seed = yield* database.begin();
        const created = yield* seed.insert("users", { name: "one" });
        yield* database.commit(yield* seed.finalize());
        const transaction = yield* database.begin();
        const original = Option.getOrThrow(yield* transaction.get(created));
        const size = Result.getOrThrow(captureDocumentObjectWithSize(original)).semanticSizeBytes;
        yield* transaction.patch(created, { name: "two" });
        yield* transaction.patch(created, { name: "six" });
        expect((yield* transaction.usage).user).toMatchObject({ documentsWritten: 2, bytesWritten: 2 * size,
          documentsRead: 3, bytesRead: 3 * size });
        expect((yield* transaction.usage).databaseQueries).toBe(1);
        yield* database.commit(yield* transaction.finalize());
        const tooMany = yield* database.begin();
        yield* tooMany.patch(created, { name: "one" });
        yield* tooMany.patch(created, { name: "two" });
        const refusal = yield* Effect.result(tooMany.patch(created, { name: "six" }));
        expect(Result.isFailure(refusal) && refusal.failure).toMatchObject({ reason: "capacity", cause: { budget: "documentsWritten", actual: 3, limit: 2 } });
        expect((yield* tooMany.usage).user.documentsWritten).toBe(3);
        yield* tooMany.abort();
        const current = yield* database.begin();
        expect(Option.getOrThrow(yield* current.get(created)).name).toBe("six");
        yield* current.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("enforces cached read/byte/query budgets and rejects excessive nesting before staging", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, { ...options, transactionLimits: { documentsRead: 2 } });
        yield* activateCoreSchema(database, schema, publication);
        const seed = yield* database.begin();
        const created = yield* seed.insert("users", { name: "one" });
        yield* database.commit(yield* seed.finalize());
        const transaction = yield* database.begin();
        yield* transaction.get(created);
        yield* transaction.get(created);
        const refusal = yield* Effect.result(transaction.get(created));
        expect(Result.isFailure(refusal) && refusal.failure).toMatchObject({ reason: "capacity", cause: { budget: "documentsRead", actual: 3, limit: 2 } });
        expect((yield* transaction.usage).user.documentsRead).toBe(3);
        yield* transaction.abort();
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, { ...options, transactionLimits: { bytesRead: 1, bytesWritten: 1, databaseQueries: 1 } });
        const read = yield* database.begin();
        const refusal = yield* Effect.result(read.scan("users", "by_name"));
        expect(Result.isFailure(refusal) && refusal.failure).toMatchObject({ reason: "capacity", cause: { budget: "bytesRead" } });
        yield* read.abort();
        const write = yield* database.begin();
        const bytes = yield* Effect.result(write.insert("users", { name: "oversized-for-this-budget" }));
        expect(Result.isFailure(bytes) && bytes.failure).toMatchObject({ reason: "capacity", cause: { budget: "bytesWritten" } });
        expect((yield* write.usage).user.bytesWritten).toBeGreaterThan(1);
        yield* write.abort();
        const queries = yield* database.begin();
        const usersNumber = yield* queries.tableNumber("users");
        expect(Option.isNone(yield* queries.get(Result.getOrThrow(encodeDocumentId(usersNumber, id(200)))))).toBe(true);
        const extraQuery = yield* Effect.result(queries.get(Result.getOrThrow(encodeDocumentId(usersNumber, id(201)))));
        expect(Result.isFailure(extraQuery) && extraQuery.failure).toMatchObject({ reason: "capacity", cause: { budget: "databaseQueries" } });
        yield* queries.abort();
        const nesting = yield* database.begin();
        let nested: unknown = "leaf";
        for (let depth = 0; depth < 17; depth += 1) nested = { child: nested };
        const invalid = yield* Effect.result(nesting.insert("users", nested));
        expect(Result.isFailure(invalid) && invalid.failure).toMatchObject({ reason: "invalidValue" });
        expect((yield* nesting.usage).user.documentsWritten).toBe(0);
        yield* nesting.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("fails closed on corrupted stored system fields after reconstruction through point and index readers", async () => {
    const fixture = await createFixture();
    let created = "";
    let activatedTable: CoreTableDefinition | undefined;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        activatedTable = (yield* activateCoreSchema(database, schema, publication)).tables.find(table => table.name === "users");
        const seed = yield* database.begin();
        created = yield* seed.insert("users", { name: "one" });
        yield* database.commit(yield* seed.finalize());
      })));
      const decoded = Result.getOrThrow(decodeDocumentId(created));
      if (activatedTable === undefined) throw new Error("Missing activated users table");
      const corruptions = [
        { name: "one" },
        { name: "one", _id: "invalid", _creationTime: 1 },
        { name: "one", _id: created, _creationTime: 0 },
        { name: "one", _id: created, _creationTime: Number.NaN },
        { name: "one", _id: Result.getOrThrow(encodeDocumentId(decoded.tableNumber + 1, decoded.internalId)), _creationTime: 1 },
      ];
      for (const corruption of corruptions) {
        const value = Result.getOrThrow(encodeDocumentValue(corruption));
        await fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
          WHERE instance_name=$2 AND table_id=$3 AND id=$4`, [value, fixture.instanceName, activatedTable.tabletId, decoded.internalId]);
        const reopened = await fixture.reopen();
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(reopened, options);
          const transaction = yield* database.begin();
          const point = yield* Effect.result(transaction.get(created));
          expect(Result.isFailure(point) && point.failure).toMatchObject({ reason: "corruptData" });
          const index = yield* Effect.result(transaction.scan("users", "by_name"));
          expect(Result.isFailure(index) && index.failure).toMatchObject({ reason: "corruptData" });
          yield* transaction.abort();
        })));
      }
    } finally { await fixture.close(); }
  }, 30_000);
});

}
