import { randomBytes } from "node:crypto";
import { Clock, Deferred, Effect, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "../../src/core/database";
import { issueFinalizedTransaction, type CoreDatabaseOptions, type CoreFinalizedTransaction, type CoreInstallation, type CoreRequestClaim, type CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence } from "../../src/core/contracts";
import { captureDocumentObject, captureDocumentObjectWithSize, captureDocumentValue, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { readDocumentObject, validateTableDefinition } from "../../src/core/registry";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type { CorePersistenceFixture } from "./fixture";

const id = (last: number) => { const bytes = new Uint8Array(16); bytes[15] = last; return bytes; };
const options: CoreDatabaseOptions = { now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)) };
const identity = { functionPath: "users:deleteThroughInternal", programHash: "program-a", schemaHash: "schema-a" };
const installation: CoreInstallation = { authorityEpoch: 1n, tables: [{
  name: "users", number: 10000, tabletId: id(100), validator: { type: "object", value: {
    name: { fieldType: { type: "string" }, optional: false }, padding: { fieldType: { type: "string" }, optional: true },
  } }, indexes: [{ name: "by_name", ref: { id: id(101) }, fields: ["name"], enabled: true }],
}], programs: [{ identity, metadata: { artifact: "immutable-source" } }] };

export function registerCoreBootstrapScenarios(name: string, createFixture: (options?: Readonly<{ sqlPageSize?: number }>) => Promise<CorePersistenceFixture>) {
describe(name, () => {
  it("packs admitted nested validators while retaining the document nesting limit and cold schema enforcement", async () => {
    const fixture = await createFixture();
    let validator: ValidatorJsonV1 = { type: "string" };
    let value: DocumentValue = "leaf";
    for (let depth = 0; depth < 5; depth += 1) {
      validator = { type: "object", value: { child: { fieldType: validator, optional: false } } };
      value = { child: value };
    }
    const expectedDocument = Result.getOrThrow(captureDocumentObject(value));
    const table: CoreTableDefinition = { name: "users", number: 10000, tabletId: id(100), validator, indexes: [] };
    expect(Result.isSuccess(validateTableDefinition(table))).toBe(true);
    let created = "";
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install({ tables: [table], programs: [] });
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
        yield* database.install({ tables: [], programs: [{ identity, metadata }] });
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
            if (document.name === "users" && document.number === 10000) records.set("validator", { entry, document });
            if (document.kind === "revision") records.set("metadata", { entry, document });
          }
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* database.install(installation);
      })));
      for (const [field, malformed] of [
        ["validator", ["{", '{"type":"unsupported"}', { type: "any" }, undefined]],
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
          const restored = await Effect.runPromise(Effect.scoped(Effect.result(openCoreDatabase(reopened, options))));
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
        yield* database.install(installation);
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

  it("rejects malformed, missing and non-string packed outcomes as corrupt stored records", async () => {
    const fixture = await createFixture();
    const request = { key: "corrupt-packed-result", requestHash: "packed-request", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let observeOutcome = false;
        let stored: CoreDocumentLogEntry | undefined;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          if (observeOutcome) {
            expect(batch.documents).toHaveLength(1);
            stored = batch.documents[0];
          }
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* database.install(installation);
        const acquisition = yield* database.claimRequest(request);
        if (acquisition.kind !== "claimed") throw new Error("Expected request claim");
        const transaction = yield* database.begin({ claim: acquisition.claim });
        observeOutcome = true;
        yield* database.commit(yield* transaction.finalize(), { claim: acquisition.claim, result: "valid-result" });
        const entry = stored;
        if (entry === undefined) throw new Error("Missing observed outcome revision");
        const document = Result.getOrThrow(readDocumentObject(entry));
        const corruptions = [
          { ...document, result: "{" },
          { ...document, result: '{"$integer":"invalid-base64"}' },
          { ...document, result: 42 },
          Object.fromEntries(Object.entries(document).filter(([name]) => name !== "result")),
        ];
        for (const corruption of corruptions) {
          const bytes = Result.getOrThrow(encodeDocumentValue(corruption));
          yield* Effect.tryPromise(() => fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5`,
          [bytes, fixture.instanceName, entry.tableId, entry.id, entry.ts.toString()]));
          const resolution = yield* Effect.result(database.resolveRequest(request));
          expect(Result.isFailure(resolution) && resolution.failure).toMatchObject({ reason: "corruptData" });
        }
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        const resolution = yield* Effect.result(database.recoverRequest(request));
        expect(Result.isFailure(resolution) && resolution.failure).toMatchObject({ reason: "corruptData" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("classifies only pre-stage document validator refusals and permits a caught refusal followed by valid writes", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(installation);
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
        yield* database.install(installation);
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
        yield* database.install(installation);
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

  it("conflicts an empty-table index installation with an insert committed after its emptiness check", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scanned = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let pause = false;
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: at => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(at);
          return { ...snapshot, scan: query => Effect.gen(function* () {
            const page = yield* snapshot.scan(query);
            if (pause && query.tableId[15] === 100 && query.maxResults === 1) {
              pause = false;
              expect(page.entries).toHaveLength(0);
              yield* Deferred.succeed(scanned, undefined);
              yield* Deferred.await(release);
            }
            return page;
          }) };
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* database.install(installation);
        const table = installation.tables[0];
        if (table === undefined) throw new Error("Missing users definition");
        const changed: CoreInstallation = { tables: [{ ...table, indexes: [...table.indexes,
          { name: "by_padding", ref: { id: id(102) }, fields: ["padding"], enabled: true }],
        }], programs: [] };
        pause = true;
        const installing = yield* Effect.forkChild(Effect.result(database.install(changed)));
        yield* Deferred.await(scanned);
        yield* Effect.ensuring(Effect.gen(function* () {
          const inserting = yield* database.begin();
          yield* inserting.insert("users", { name: "inserted-under-old-schema", padding: "indexed-later" });
          yield* database.commit(yield* inserting.finalize());
        }), Deferred.succeed(release, undefined));
        const installed = yield* Fiber.join(installing);
        expect(Result.isFailure(installed) && installed.failure).toMatchObject({ reason: "conflict" });
        const reader = yield* database.begin();
        expect((yield* reader.scan("users", "by_name"))).toMatchObject([{ name: "inserted-under-old-schema" }]);
        const absentIndex = yield* Effect.result(reader.scan("users", "by_padding"));
        expect(Result.isFailure(absentIndex) && absentIndex.failure).toMatchObject({ reason: "missingIndex" });
        yield* reader.abort();
        const populated = yield* Effect.result(database.install(changed));
        expect(Result.isFailure(populated) && populated.failure).toMatchObject({ reason: "indexUnavailable" });
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("indexes only own fields for absent prototype names and nested accepted object keys", async () => {
    const fixture = await createFixture();
    const fields = ["toString", "constructor", "hasOwnProperty", "nested.toString", "nested.constructor",
      "nested.hasOwnProperty", "nested.__proto__.toString"];
    const stringValidator: ValidatorJsonV1 = { type: "string" };
    const special: CoreInstallation = { tables: [{ name: "users", number: 10000, tabletId: id(100),
      validator: { type: "object", value: {
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
      } }, indexes: fields.map((field, index) => ({ name: `special_${index}`, ref: { id: id(110 + index) },
        fields: [field], enabled: true })),
    }], programs: [] };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(special);
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

  it("bootstraps logical metadata, hydrates same-key revisions and preserves old snapshots on reopen", async () => {
    const fixture = await createFixture({ sqlPageSize: 2 });
    let created = "";
    let oldTimestamp = 0n;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(installation);
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
        yield* database.install(installation);
        expect(yield* database.publishedTimestamp).toBe(beforeReplay);
        expect((yield* database.selectProgram(identity.functionPath)).metadata.artifact).toBe("immutable-source");
        expect(yield* database.readAuthorityEpoch).toBe(1n);
        const older = yield* database.begin({ at: oldTimestamp });
        expect((yield* older.scan("users", "by_name"))).toMatchObject([{ padding: "before" }]);
        yield* older.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("keeps request claims/outcomes and terminal failure in logical revisions", async () => {
    const fixture = await createFixture();
    const request = { key: "request-one", requestHash: "request-hash", program: identity };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(installation);
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
        yield* database.install(installation);
        const foreign = yield* Effect.result(database.commit(issueFinalizedTransaction()));
        expect(Result.isFailure(foreign) && foreign.failure).toMatchObject({ reason: "foreignFinalization" });
        const transaction = yield* database.begin({ program: identity, authorityEpoch: 1n });
        yield* transaction.insert("users", { name: "original" });
        yield* database.install({ tables: [], programs: [{ identity: { ...identity, programHash: "program-b" }, metadata: {} }] });
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
        yield* database.install(installation);
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
        yield* database.install({ ...installation, programs: [...installation.programs, { identity: otherProgram, metadata: {} }] });
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
        yield* database.install(installation);
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
        yield* database.install(installation);
        delayed = true;
        const installingAlpha = yield* Effect.forkChild(database.install({ tables: [], programs: [{ identity: {
          ...identity, functionPath: "alpha:query",
        }, metadata: { owner: "alpha" } }] }));
        yield* Deferred.await(started);
        const collision = yield* Effect.result(database.install({ tables: [], programs: [{ identity: {
          ...identity, functionPath: "alpha:query", programHash: "collision",
        }, metadata: {} }] }));
        expect(Result.isFailure(collision) && collision.failure).toMatchObject({ reason: "conflict" });
        const installingBeta = yield* Effect.forkChild(database.install({ tables: [], programs: [{ identity: {
          ...identity, functionPath: "beta:query",
        }, metadata: { owner: "beta" } }] }));
        yield* Deferred.await(secondSaved);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(installingAlpha);
        yield* Fiber.join(installingBeta);
        expect((yield* database.selectProgram("alpha:query")).metadata.owner).toBe("alpha");
        expect((yield* database.selectProgram("beta:query")).metadata.owner).toBe("beta");
        const transaction = yield* database.begin();
        expect(yield* transaction.tableNumber("users")).toBe(10000);
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
        yield* database.install(installation);
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
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: at => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(at);
          return { ...snapshot, get: (table, document) => Effect.gen(function* () {
            if (pause) { pause = false; yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
            return yield* snapshot.get(table, document);
          }) };
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* database.install(installation);
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
        yield* database.install(installation);
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
        const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: at => Effect.gen(function* () {
          const snapshot = yield* fixture.persistence.readSnapshot(at);
          return { ...snapshot, get: (table, document) => Effect.gen(function* () {
            if (pause) { pause = false; yield* Deferred.succeed(started, undefined); yield* Deferred.await(release); }
            return yield* snapshot.get(table, document);
          }) };
        }) };
        const database = yield* openCoreDatabase(persistence, options);
        yield* database.install(installation);
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
        yield* database.install(installation);
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
        yield* database.install(installation);
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
        expect(Option.isNone(yield* queries.get(Result.getOrThrow(encodeDocumentId(10000, id(200)))))).toBe(true);
        const extraQuery = yield* Effect.result(queries.get(Result.getOrThrow(encodeDocumentId(10000, id(201)))));
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

  it("fails closed on corrupted stored system fields through both point and index readers", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(installation);
        const seed = yield* database.begin();
        const created = yield* seed.insert("users", { name: "one" });
        yield* database.commit(yield* seed.finalize());
        const decoded = Result.getOrThrow(decodeDocumentId(created));
        const corruptions = [
          { name: "one" },
          { name: "one", _id: "invalid", _creationTime: 1 },
          { name: "one", _id: created, _creationTime: 0 },
          { name: "one", _id: created, _creationTime: Number.NaN },
          { name: "one", _id: Result.getOrThrow(encodeDocumentId(10001, decoded.internalId)), _creationTime: 1 },
        ];
        for (const corruption of corruptions) {
          const value = Result.getOrThrow(encodeDocumentValue(corruption));
          yield* Effect.tryPromise(() => fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$1
            WHERE instance_name=$2 AND table_id=$3 AND id=$4`, [value, fixture.instanceName, id(100), decoded.internalId]));
          const transaction = yield* database.begin();
          const point = yield* Effect.result(transaction.get(created));
          expect(Result.isFailure(point) && point.failure).toMatchObject({ reason: "corruptData" });
          const index = yield* Effect.result(transaction.scan("users", "by_name"));
          expect(Result.isFailure(index) && index.failure).toMatchObject({ reason: "corruptData" });
          yield* transaction.abort();
        }
      })));
    } finally { await fixture.close(); }
  }, 30_000);
});

}
