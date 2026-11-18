import { randomBytes } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreDatabaseOptions, CoreError } from "../../src/core/api";
import { CORE_BUILTIN_TABLE_NUMBERS, DATABASE_GLOBALS, INDEXES, TABLES, readDocumentObject } from "../../src/core/registry";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const DAY = 86_400_000_000_000n;
const seed = (value: number) => new Uint8Array(32).fill(value);
const internal = (id: string) => Result.getOrThrow(decodeDocumentId(id)).internalId;
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)) };
const itemsSchema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{ tableName: "items",
  documentType: { type: "object", value: { value: { fieldType: { type: "string" }, optional: false } } }, indexes: [],
}] }));

const observe = Effect.fn("TransactionIdFixture.observe")(function* (fixture: CorePersistenceFixture, timestamp: bigint) {
  const registry = yield* readCoreFixtureRegistry(fixture, timestamp);
  const snapshot = yield* fixture.persistence.readSnapshot(timestamp);
  const globals = registry.table(DATABASE_GLOBALS)?.definition;
  const byId = globals?.indexes.find(index => index.name === "by_id");
  if (globals === undefined || byId === undefined) return yield* Effect.die(new Error("Missing database globals table."));
  const page = yield* snapshot.scan({ tableId: globals.tabletId, index: byId.ref,
    interval: { start: null, end: null }, order: "asc", maxResults: 2 });
  const row = page.entries[0]?.document;
  if (row === undefined || page.entries.length !== 1 || page.cursor.kind !== "end")
    return yield* Effect.die(new Error("Expected one database globals document."));
  return { registry, snapshot, globals: yield* Effect.fromResult(readDocumentObject(row, globals)) };
});

function nested(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index++) value = { next: value };
  return value;
}

export function registerTransactionIdScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("shares bootstrap entropy, keeps UUID entropy independent and reserves user ID/time before metadata", async () => {
      const fixture = await createFixture();
      const bootSeed = Uint8Array.from({ length: 32 }, (_, index) => index);
      const userSeed = seed(7);
      const lengths: number[] = [];
      let selectedSeed: Uint8Array | undefined = bootSeed;
      const runtime: CoreDatabaseOptions = { ...options, now: Effect.succeed(9n * DAY), randomBytes: length => Effect.sync(() => {
        lengths.push(length);
        if (length === 16) return new Uint8Array(16).fill(0xa5);
        const selected = selectedSeed;
        selectedSeed = undefined;
        return selected ?? randomBytes(length);
      }) };
      try {
        const expected = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(fixture.persistence, runtime);
          expect(lengths).toEqual([32, 16]);
          const before = yield* observe(fixture, yield* database.publishedTimestamp);
          expect(before.globals.awsPrefixSecret).toBe("a5a5a5a5-a5a5-45a5-a5a5-a5a5a5a5a5a5");
          const bootstrap = Result.getOrThrow(createTransactionIdGenerator(bootSeed, 9n * DAY));
          const tables = [...CORE_BUILTIN_TABLE_NUMBERS.keys()].map(name => before.registry.table(name));
          expect(tables.map(table => table?.id)).toEqual(tables.map(() => bootstrap.nextInternalId()));

          selectedSeed = userSeed;
          const transaction = yield* database.begin();
          const preview = Result.getOrThrow(createTransactionIdGenerator(userSeed, 9n * DAY));
          const expectedIds = Array.from({ length: 4 }, () => preview.nextInternalId());
          const id = yield* transaction.insert("fresh", { value: "first" });
          const user = Option.getOrThrow(yield* transaction.get(id));
          expect(internal(id)).toEqual(expectedIds[0]);
          const committed = yield* database.commit(yield* transaction.finalize());
          const after = yield* observe(fixture, committed);
          const fresh = after.registry.table("fresh")?.definition;
          const catalog = after.registry.table(TABLES)?.definition;
          const indexes = after.registry.table(INDEXES)?.definition;
          const byId = fresh?.indexes.find(index => index.name === "by_id");
          const byCreation = fresh?.indexes.find(index => index.name === "by_creation_time");
          if (fresh === undefined || catalog === undefined || indexes === undefined || byId === undefined || byCreation === undefined)
            return yield* Effect.die(new Error("Missing generated table metadata."));
          expect([fresh.tabletId, byId.ref.id, byCreation.ref.id]).toEqual(expectedIds.slice(1));
          const tableRow = Option.getOrThrow(yield* after.snapshot.get(catalog.tabletId, fresh.tabletId));
          const idRow = Option.getOrThrow(yield* after.snapshot.get(indexes.tabletId, byId.ref.id));
          const creationRow = Option.getOrThrow(yield* after.snapshot.get(indexes.tabletId, byCreation.ref.id));
          const times = [user._creationTime,
            (yield* Effect.fromResult(readDocumentObject(tableRow, catalog)))._creationTime,
            (yield* Effect.fromResult(readDocumentObject(idRow, indexes)))._creationTime,
            (yield* Effect.fromResult(readDocumentObject(creationRow, indexes)))._creationTime];
          expect(times.every(value => typeof value === "number")).toBe(true);
          for (let index = 1; index < times.length; index++) {
            const previous = times[index - 1], next = times[index];
            if (typeof previous !== "number" || typeof next !== "number") return yield* Effect.die(new Error("Invalid metadata creation time."));
            expect(next).toBeGreaterThan(previous);
          }
          return { id, committed, globals: after.globals,
            tablets: [...after.registry.tables.values()].map(record => record.id) };
        })));
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), runtime);
          expect(lengths.filter(length => length === 16)).toHaveLength(1);
          expect(yield* database.publishedTimestamp).toBe(expected.committed);
          const cold = yield* observe(fixture, expected.committed);
          expect(cold.globals).toEqual(expected.globals);
          expect([...cold.registry.tables.values()].map(record => record.id)).toEqual(expected.tablets);
          const read = yield* database.begin();
          expect(Option.getOrThrow(yield* read.get(expected.id))).toMatchObject({ value: "first" });
          yield* read.abort();
        })));
      } finally { await fixture.close(); }
    }, 90_000);

    it("pins the raw wall-clock day despite snapshot-raised creation time and starts fresh on the next attempt", async () => {
      const fixture = await createFixture();
      let now = 10n * DAY;
      let selectedSeed: Uint8Array | undefined;
      const runtime = { ...options, now: Effect.sync(() => now), randomBytes: (length: 16 | 32) => Effect.sync(() => {
        const selected = length === 32 ? selectedSeed : undefined;
        if (length === 32) selectedSeed = undefined;
        return selected ?? randomBytes(length);
      }) };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        const future = yield* database.begin();
        yield* future.insert("future_anchor", { value: "published in the future" });
        yield* database.commit(yield* future.finalize());
        now = 2n * DAY;
        selectedSeed = seed(3);
        const first = yield* database.begin();
        const firstId = yield* first.insert("days", { value: 1 });
        expect(internal(firstId).slice(14)).toEqual(Uint8Array.of(0, 2));
        expect(Option.getOrThrow(yield* first.get(firstId))._creationTime).toBeGreaterThanOrEqual(Number(10n * DAY) / 1_000_000);
        now = 11n * DAY;
        const secondId = yield* first.insert("days", { value: 2 });
        expect(internal(secondId).slice(14)).toEqual(Uint8Array.of(0, 2));
        yield* first.abort();
        selectedSeed = seed(3);
        const next = yield* database.begin();
        const nextId = yield* next.insert("days", { value: 3 });
        expect(internal(nextId).slice(0, 14)).toEqual(internal(firstId).slice(0, 14));
        expect(internal(nextId).slice(14)).toEqual(Uint8Array.of(0, 11));
        yield* next.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("preserves generic, document, schema and size refusal phases and accepts matching supplied system fields", async () => {
      const fixture = await createFixture();
      let selectedSeed: Uint8Array | undefined;
      const runtime = { ...options, randomBytes: (length: 16 | 32) => Effect.sync(() => {
        const selected = length === 32 ? selectedSeed : undefined;
        if (length === 32) selectedSeed = undefined;
        return selected ?? randomBytes(length);
      }) };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        yield* activateCoreSchema(database, itemsSchema);
        selectedSeed = seed(4);
        const generic = yield* database.begin();
        for (const value of [null, [], { value: nested(65) }, { value: new Array(8193).fill(null) }])
          expect(failure(yield* Effect.result(generic.insert("items", value)))).toMatchObject({ reason: "invalidValue" });
        expect(failure(yield* Effect.result(generic.insert("_private", { value: "forbidden" })))).toMatchObject({ reason: "invalidValue" });
        const first = yield* generic.insert("items", { value: "after generic failures" });
        const zeroDraws = Result.getOrThrow(createTransactionIdGenerator(seed(4), 1_000_000_000n));
        expect(internal(first)).toEqual(zeroDraws.nextInternalId());
        yield* generic.abort();

        const large = "x".repeat(1 << 20);
        const wide = Object.fromEntries(Array.from({ length: 1023 }, (_, index) => ["field" + index, index]));
        const refusals: readonly Readonly<{ value: unknown; reason: "invalidValue" | "documentValidation" }>[] = [
          { value: { value: "allowed", _hidden: true }, reason: "invalidValue" },
          { value: { value: nested(17) }, reason: "invalidValue" },
          { value: { value: 42 }, reason: "documentValidation" },
          { value: { wrong: large }, reason: "documentValidation" },
          { value: { value: large }, reason: "invalidValue" },
          { value: { ...wide, value: "allowed" }, reason: "invalidValue" },
          { value: { value: "allowed", _id: "mismatch" }, reason: "invalidValue" },
        ];
        for (const refused of refusals) {
          selectedSeed = seed(5);
          const transaction = yield* database.begin();
          expect(failure(yield* Effect.result(transaction.insert("items", refused.value)))).toMatchObject({ reason: refused.reason });
          const preview = Result.getOrThrow(createTransactionIdGenerator(seed(5), 1_000_000_000n));
          preview.nextInternalId();
          const recovered = yield* transaction.insert("items", { value: "after refusal" });
          expect(internal(recovered)).toEqual(preview.nextInternalId());
          expect(Option.getOrThrow(yield* transaction.get(recovered))._creationTime).toBeGreaterThan(transaction.unixTime);
          yield* transaction.abort();
        }

        selectedSeed = seed(6);
        const matching = yield* database.begin();
        const preview = Result.getOrThrow(createTransactionIdGenerator(seed(6), 1_000_000_000n));
        const expected = Result.getOrThrow(encodeDocumentId(yield* matching.tableNumber("items"), preview.nextInternalId()));
        expect(yield* matching.insert("items", { value: "matching", _id: expected, _creationTime: matching.unixTime })).toBe(expected);
        yield* database.commit(yield* matching.finalize());
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("captures seed bytes before the clock wait and releases failed or interrupted construction", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let now = 1_000_000_000n, clockReads = 0, entropyAcquired = false;
        let selectedSeed: Uint8Array | undefined;
        let gate: Readonly<{ entered: Deferred.Deferred<void>; release: Deferred.Deferred<bigint> }> | undefined;
        const runtime: CoreDatabaseOptions = { ...options, maxInflight: 1,
          randomBytes: length => Effect.sync(() => {
            if (length === 32) entropyAcquired = true;
            const selected = length === 32 ? selectedSeed : undefined;
            if (length === 32) selectedSeed = undefined;
            return selected ?? randomBytes(length);
          }), now: Effect.suspend(() => {
            clockReads++;
            const selected = gate;
            return selected === undefined || !entropyAcquired ? Effect.succeed(now)
              : Deferred.succeed(selected.entered, undefined).pipe(Effect.andThen(Deferred.await(selected.release)));
          }) };
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        const before = yield* database.publishedTimestamp;
        const original = seed(7), borrowed = original.slice();
        selectedSeed = borrowed;
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<bigint>();
        entropyAcquired = false;
        gate = { entered, release };
        const constructing = yield* database.begin().pipe(Effect.forkScoped);
        yield* Effect.gen(function* () {
          yield* Deferred.await(entered).pipe(Effect.raceFirst(Fiber.join(constructing).pipe(Effect.andThen(
            Effect.die(new Error("Constructor completed before its seed-copy clock pause.")),
          ))), Effect.timeout(5_000));
          borrowed.fill(0);
          gate = undefined;
          yield* Deferred.succeed(release, now);
          const transaction = yield* Fiber.join(constructing).pipe(Effect.timeout(5_000));
          const id = yield* transaction.insert("entropy_rows", { value: "owned seed" });
          expect(internal(id)).toEqual(Result.getOrThrow(createTransactionIdGenerator(original, now)).nextInternalId());
          yield* transaction.abort();
        }).pipe(Effect.onExit(() => Effect.gen(function* () {
          gate = undefined;
          yield* Deferred.succeed(release, now);
          const completion = yield* Fiber.await(constructing).pipe(Effect.interruptible, Effect.timeout(5_000));
          if (Exit.isSuccess(completion)) yield* completion.value.abort();
        })));

        const previousReads = clockReads;
        selectedSeed = new Uint8Array(31);
        entropyAcquired = false;
        expect(failure(yield* Effect.result(database.begin()))).toMatchObject({ reason: "invalidValue" });
        // The creation clock is read first; invalid entropy prevents the RNG's own clock read.
        expect(clockReads).toBe(previousReads + 1);
        now = -1n;
        expect(failure(yield* Effect.result(database.begin()))).toMatchObject({ reason: "invalidValue" });
        now = 1_000_000_000n;

        const interruptEntered = yield* Deferred.make<void>(), interruptRelease = yield* Deferred.make<bigint>();
        entropyAcquired = false;
        gate = { entered: interruptEntered, release: interruptRelease };
        const interrupted = yield* database.begin().pipe(Effect.forkScoped);
        let interrupting: Fiber.Fiber<void> | undefined;
        yield* Effect.gen(function* () {
          yield* Deferred.await(interruptEntered).pipe(Effect.raceFirst(Fiber.join(interrupted).pipe(Effect.andThen(
            Effect.die(new Error("Constructor completed before its interruption clock pause.")),
          ))), Effect.timeout(5_000));
          // Interrupt acknowledgement may itself be uninterruptibly waiting for
          // the target. Observe the target independently so timeout reaches the Effect finalizer.
          interrupting = yield* Fiber.interrupt(interrupted).pipe(Effect.forkScoped);
          const exit = yield* Fiber.await(interrupted).pipe(Effect.timeout(5_000));
          expect(yield* Deferred.isDone(interruptRelease)).toBe(false);
          expect(Exit.isFailure(exit) && exit.cause.reasons.length > 0
            && exit.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
        }).pipe(Effect.onExit(() => Effect.gen(function* () {
          gate = undefined;
          yield* Deferred.succeed(interruptRelease, now);
          const [completion, request] = yield* Effect.all([Fiber.await(interrupted), interrupting === undefined
            ? Effect.succeed(Exit.void) : Fiber.await(interrupting)] as const, { concurrency: 2 }).pipe(Effect.interruptible, Effect.timeout(5_000));
          if (Exit.isSuccess(completion)) yield* completion.value.abort();
          if (Exit.isFailure(request)) yield* Effect.failCause(request.cause);
        })));
        const resumed = yield* database.begin().pipe(Effect.timeout(5_000));
        yield* resumed.abort();
        expect(yield* database.publishedTimestamp).toBe(before);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it.each(["seed", "clock", "uuid"] as const)("refuses invalid bootstrap %s before publishing anchors and can reopen", async invalid => {
      const fixture = await createFixture();
      let rejected = true, clockReads = 0;
      const runtime: CoreDatabaseOptions = { ...options,
        now: Effect.sync(() => { clockReads++; return rejected && invalid === "clock" ? -1n : 1_000_000_000n; }),
        randomBytes: length => Effect.sync(() => rejected && ((invalid === "seed" && length === 32)
          || (invalid === "uuid" && length === 16)) ? new Uint8Array(length - 1) : randomBytes(length)),
      };
      try {
        const result = await Effect.runPromise(Effect.result(Effect.scoped(openCoreDatabase(fixture.persistence, runtime))));
        expect(failure(result)).toMatchObject({ reason: "invalidValue" });
        if (invalid === "seed") expect(clockReads).toBe(0);
        for (const name of ["tables_table_id", "index_table_id", "tables_by_id", "index_by_id"])
          expect(Option.isNone(await Effect.runPromise(fixture.persistence.getGlobal(name)))).toBe(true);
        rejected = false;
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), runtime);
          const transaction = yield* database.begin();
          yield* transaction.insert("recovered", { value: "fresh bootstrap" });
          yield* database.commit(yield* transaction.finalize());
        })));
      } finally { await fixture.close(); }
    }, 90_000);

    it("rejects pre-begin tombstone history when fresh attempts receive the same seed", async () => {
      const fixture = await createFixture();
      let selectedSeed: Uint8Array | undefined;
      const runtime = { ...options, randomBytes: (length: 16 | 32) => Effect.sync(() => {
        const selected = length === 32 ? selectedSeed : undefined;
        if (length === 32) selectedSeed = undefined;
        return selected ?? randomBytes(length);
      }) };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        selectedSeed = seed(8);
        const first = yield* database.begin();
        const id = yield* first.insert("identities", { value: "original" });
        yield* database.commit(yield* first.finalize());
        const deleting = yield* database.begin();
        yield* deleting.delete(id);
        const before = yield* database.commit(yield* deleting.finalize());
        selectedSeed = seed(8);
        const collision = yield* database.begin();
        expect(yield* collision.insert("identities", { value: "reused" })).toBe(id);
        const refused = yield* Effect.result(database.commit(yield* collision.finalize()));
        expect(failure(refused)).toMatchObject({ reason: "documentDeleted" });
        yield* collision.abort();
        expect(yield* database.publishedTimestamp).toBe(before);
        const verify = yield* database.begin();
        expect(Option.isNone(yield* verify.get(id))).toBe(true);
        yield* verify.abort();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("refuses a request ID collision without replacing the prior durable outcome", async () => {
      const fixture = await createFixture();
      let lockedSeed: Uint8Array | undefined;
      const runtime: CoreDatabaseOptions = { ...options, randomBytes: length => Effect.sync(() =>
        length === 32 && lockedSeed !== undefined ? lockedSeed.slice() : randomBytes(length)) };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        const program = { functionPath: "items:requestCollision", programHash: "request-collision-program", schemaHash: "request-collision-schema" };
        yield* database.publishPrograms({ programs: [{ identity: program, metadata: {} }] });
        lockedSeed = seed(9);
        const firstIdentity = { key: "request-collision:first", requestHash: "first-request", program };
        const secondIdentity = { key: "request-collision:second", requestHash: "second-request", program };
        const first = yield* database.claimRequest(firstIdentity);
        if (first.kind !== "claimed") return yield* Effect.die(new Error("First request was not claimed."));
        yield* database.abortRequest(first.claim);
        const beforeFirst = yield* database.resolveRequest(firstIdentity);
        const beforeTimestamp = yield* database.publishedTimestamp;
        expect(beforeFirst).toEqual({ kind: "failed" });

        const second = yield* Effect.result(database.claimRequest(secondIdentity));
        const afterFirst = yield* database.resolveRequest(firstIdentity);
        const afterSecond = yield* database.resolveRequest(secondIdentity);
        const afterTimestamp = yield* database.publishedTimestamp;
        // Preserve every observed outcome before checking refusal, so the
        // negative witness exposes both an overwritten A and an admitted B.
        expect({ failure: failure(second), first: afterFirst, second: afterSecond, timestamp: afterTimestamp }).toMatchObject({
          failure: { _tag: "CoreTransactionError", reason: "documentExists" },
          first: beforeFirst, second: { kind: "missing" }, timestamp: beforeTimestamp,
        });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("persists the independent Rust split-rounding creation time in pending and cold user rows", async () => {
      const fixture = await createFixture();
      const rawNow = 1_700_000_000_000_123_456n;
      // Independent Rust as_secs()/subsec_nanos() oracle; the shortcut rounds one ULP lower.
      const expectedTime = 1_700_000_000_000.1235;
      const runtime = { ...options, now: Effect.succeed(rawNow) };
      expect(Number(rawNow) / 1_000_000).not.toBe(expectedTime);
      try {
        const written = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(fixture.persistence, runtime);
          const transaction = yield* database.begin();
          const id = yield* transaction.insert("rounding", { value: "source clock" });
          expect(Option.getOrThrow(yield* transaction.get(id))._creationTime).toBe(expectedTime);
          const timestamp = yield* database.commit(yield* transaction.finalize());
          const observed = yield* observe(fixture, timestamp);
          const table = observed.registry.table("rounding")?.definition;
          if (table === undefined) return yield* Effect.die(new Error("Missing rounding table."));
          const stored = Option.getOrThrow(yield* observed.snapshot.get(table.tabletId, internal(id)));
          expect((yield* Effect.fromResult(readDocumentObject(stored, table)))._creationTime).toBe(expectedTime);
          return { id, timestamp };
        })));
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), runtime);
          expect(yield* database.publishedTimestamp).toBe(written.timestamp);
          const read = yield* database.begin();
          expect(Option.getOrThrow(yield* read.get(written.id))._creationTime).toBe(expectedTime);
          yield* read.abort();
        })));
      } finally { await fixture.close(); }
    }, 90_000);

    it("retains an insert-delete tombstone and refuses its generated identity at commit", async () => {
      const fixture = await createFixture();
      let selectedSeed: Uint8Array | undefined;
      const runtime = { ...options, randomBytes: (length: 16 | 32) => Effect.sync(() => {
        const selected = length === 32 ? selectedSeed : undefined;
        if (length === 32) selectedSeed = undefined;
        return selected ?? randomBytes(length);
      }) };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        selectedSeed = seed(10);
        const first = yield* database.begin();
        const id = yield* first.insert("coalesced", { value: "transient" });
        yield* first.delete(id);
        const committed = yield* database.commit(yield* first.finalize());
        const observed = yield* observe(fixture, committed);
        const table = observed.registry.table("coalesced")?.definition;
        if (table === undefined) return yield* Effect.die(new Error("Missing coalesced table."));
        const tombstone = Option.getOrThrow(yield* observed.snapshot.get(table.tabletId, internal(id)));
        expect(tombstone).toMatchObject({ deleted: true, prevTs: null, ts: committed });
        const read = yield* database.begin();
        expect(Option.isNone(yield* read.get(id))).toBe(true);
        yield* read.abort();

        selectedSeed = seed(10);
        const repeated = yield* database.begin();
        expect(yield* repeated.insert("coalesced", { value: "reused" })).toBe(id);
        const refused = yield* Effect.result(database.commit(yield* repeated.finalize()));
        expect(failure(refused)).toMatchObject({ reason: "documentDeleted" });
        yield* repeated.abort();
        expect(yield* database.publishedTimestamp).toBe(committed);
        const after = yield* fixture.persistence.readSnapshot(committed);
        expect(Option.getOrThrow(yield* after.get(table.tabletId, internal(id)))).toEqual(tombstone);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("characterizes the Source post-begin insert-delete boundary", async () => {
      const fixture = await createFixture();
      let selectedSeed: Uint8Array | undefined;
      const runtime = { ...options, randomBytes: (length: 16 | 32) => Effect.sync(() => {
        const selected = length === 32 ? selectedSeed : undefined;
        if (length === 32) selectedSeed = undefined;
        return selected ?? randomBytes(length);
      }) };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, runtime);
        yield* activateCoreSchema(database, itemsSchema);
        selectedSeed = seed(11);
        const delayed = yield* database.begin();
        const capturedAt = delayed.timestamp;
        selectedSeed = seed(11);
        const writer = yield* database.begin();
        const id = yield* writer.insert("items", { value: "transient writer" });
        yield* writer.delete(id);
        const committed = yield* database.commit(yield* writer.finalize());
        expect(committed).toBeGreaterThan(capturedAt);
        const observed = yield* observe(fixture, committed);
        const table = observed.registry.table("items")?.definition;
        if (table === undefined) return yield* Effect.die(new Error("Missing preinstalled item table."));
        const tombstone = Option.getOrThrow(yield* observed.snapshot.get(table.tabletId, internal(id)));
        expect(tombstone).toMatchObject({ deleted: true, prevTs: null, ts: committed });

        expect(yield* delayed.insert("items", { value: "late attempt" })).toBe(id);
        // Source emits no conflict key for oldNone/newNone. Its freshness
        // search ends at the attempt snapshot, so the late insert may commit.
        const published = yield* database.commit(yield* delayed.finalize());
        expect(published).toBeGreaterThan(committed);
        expect(yield* database.publishedTimestamp).toBe(published);

        const historical = yield* fixture.persistence.readSnapshot(committed);
        expect(Option.getOrThrow(yield* historical.get(table.tabletId, internal(id)))).toEqual(tombstone);
        const historicalRead = yield* database.begin({ at: committed });
        expect(Option.isNone(yield* historicalRead.get(id))).toBe(true);
        yield* historicalRead.abort();

        const current = yield* fixture.persistence.readSnapshot(published);
        const live = Option.getOrThrow(yield* current.get(table.tabletId, internal(id)));
        expect(live).toMatchObject({ deleted: false, ts: published });
        expect(yield* Effect.fromResult(readDocumentObject(live, table))).toMatchObject({ _id: id, value: "late attempt" });
        const currentRead = yield* database.begin();
        expect(Option.getOrThrow(yield* currentRead.get(id))).toMatchObject({ _id: id, value: "late attempt" });
        yield* currentRead.abort();

        const revisions = yield* fixture.persistence.previousRevisions([
          { tableId: table.tabletId, id: internal(id), ts: committed + 1n },
          { tableId: table.tabletId, id: internal(id), ts: published + 1n },
        ]);
        expect(revisions).toHaveLength(2);
        expect(revisions.find(revision => revision.query.ts === committed + 1n)?.document).toMatchObject({ deleted: true, ts: committed });
        expect(revisions.find(revision => revision.query.ts === published + 1n)?.document).toMatchObject({ deleted: false, ts: published });
      }))); } finally { await fixture.close(); }
    }, 90_000);
  });
}
