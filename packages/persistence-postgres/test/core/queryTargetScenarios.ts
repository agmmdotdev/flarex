import { randomBytes } from "node:crypto";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreDatabase, CoreDatabaseOptions, CoreQueryOperation, CoreQueryTarget, CoreReadToken } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { captureCoreSchema } from "../../src/core/schemaTypes";
import type { CorePersistenceFixture } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const path = "items:read";
const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)) };
const schema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{ tableName: "items",
  documentType: { type: "object", value: { value: { fieldType: { type: "number" }, optional: false } } },
  indexes: [{ indexDescriptor: "by_value", fields: ["value"] }], stagedDbIndexes: [] }] }));
const publication = { programs: [{ identity: { functionPath: path, programHash: "original", schemaHash: "schema" }, metadata: {} }] };
const budget = { maximumElapsedMilliseconds: 10_000 };
const prepare = Effect.fn("CoreQueryTargetScenario.prepare")(function* (database: CoreDatabase) {
  yield* activateCoreSchema(database, schema, publication);
  const transaction = yield* database.begin();
  const first = yield* transaction.insert("items", { value: 1 });
  const second = yield* transaction.insert("items", { value: 10 });
  yield* database.commit(yield* transaction.finalize());
  return { first, second };
});
const patch = Effect.fn("CoreQueryTargetScenario.patch")(function* (database: CoreDatabase, id: string, value: number) {
  const transaction = yield* database.begin();
  yield* transaction.patch(id, { value });
  return yield* database.commit(yield* transaction.finalize());
});
const evaluate = Effect.fn("CoreQueryTargetScenario.evaluate")(function* (target: CoreQueryTarget, id: string) {
  const operation = yield* target.beginQuery(path);
  const value = Option.getOrThrow(yield* operation.transaction.get(id)).value;
  return { value, token: yield* operation.finish() };
});

export function registerCoreQueryTargetScenarios(name: string, createFixture: () => Promise<CorePersistenceFixture>) {
describe(name, () => {
  it("evaluates multiple queries at one fixed target while later relevant writes continue", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      let now = 1_000_000_000n;
      const database = yield* openCoreDatabase(fixture.persistence, { ...options, now: Effect.sync(() => now) });
      const { first } = yield* prepare(database);
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        const timestamp = target.timestamp;
        // Logical time can advance beyond the registry cache's ten-second
        // window while this bounded wall-clock callback still owns its target.
        now += 11_000_000_000n;
        yield* patch(database, first, 2);
        expect(yield* evaluate(target, first)).toMatchObject({ value: 1, token: { timestamp } });
        yield* patch(database, first, 3);
        expect(yield* evaluate(target, first)).toMatchObject({ value: 1, token: { timestamp } });
        expect(yield* database.publishedTimestamp).toBeGreaterThan(timestamp);
      }));
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        expect((yield* evaluate(target, first)).value).toBe(3);
      }));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("refreshes exact dependencies through fixed T without including later writes", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      const { first, second } = yield* prepare(database);
      const evaluated = yield* database.withQueryTarget(budget, target => evaluate(target, first));
      yield* patch(database, second, 11);
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        yield* patch(database, first, 2);
        const refreshed = Option.getOrThrow(yield* target.refresh(evaluated.token));
        expect(refreshed.timestamp).toBe(target.timestamp);
        expect(refreshed.timestamp).toBeGreaterThan(evaluated.token.timestamp);
      }));
      // Exposed buffers cannot erase the issuer's tracked dependency.
      for (const read of evaluated.token.reads) { read.indexId.fill(0); for (const interval of read.intervals) interval.start?.fill(0); }
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        expect(Option.isNone(yield* target.refresh(evaluated.token))).toBe(true);
      }));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("revokes escaped target/query capabilities and returns its bounded capacity", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, { ...options, maxQueryTargets: 1 });
      const { first } = yield* prepare(database);
      const escaped = yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        yield* database.assertQueryTarget(target);
        expect(Result.getFailure(yield* Effect.result(database.assertQueryTarget({ ...target })))).toEqual(
          Option.some(expect.objectContaining({ reason: "invalidValue" })));
        expect(Result.getFailure(yield* Effect.result(database.withQueryTarget(budget, () => Effect.void)))).toEqual(
          Option.some(expect.objectContaining({ reason: "capacity" })));
        return { target, operation: yield* target.beginQuery(path) };
      }));
      expect(Result.getFailure(yield* Effect.result(escaped.target.assertOpen))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
      expect(Result.getFailure(yield* Effect.result(escaped.target.beginQuery(path)))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
      expect(Result.getFailure(yield* Effect.result(escaped.operation.transaction.get(first)))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
      yield* database.withQueryTarget(budget, target => evaluate(target, first));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("drains interrupted query acquisition, revokes escaped operations and returns target capacity", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const escaped = yield* Deferred.make<Readonly<{ target: CoreQueryTarget; operation: CoreQueryOperation }>>();
      let armed = false, acquiring = false;
      const database = yield* openCoreDatabase(fixture.persistence, { ...options, maxQueryTargets: 1,
        randomBytes: length => Effect.gen(function* () {
          if (armed) {
            armed = false;
            acquiring = true;
            yield* Effect.uninterruptible(Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)))
              .pipe(Effect.ensuring(Effect.sync(() => { acquiring = false; })));
          }
          return yield* options.randomBytes(length);
        }),
      });
      const { first } = yield* prepare(database);
      yield* Effect.gen(function* () {
        const work = yield* Effect.forkChild(database.withQueryTarget(budget, target => Effect.gen(function* () {
          const operation = yield* target.beginQuery(path);
          yield* Deferred.succeed(escaped, { target, operation });
          armed = true;
          return yield* target.beginQuery(path);
        })));
        yield* Deferred.await(entered);
        const borrowed = yield* Deferred.await(escaped);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(work));
        yield* Effect.yieldNow;
        expect(acquiring).toBe(true);
        expect(Result.getFailure(yield* Effect.result(database.withQueryTarget(budget, () => Effect.void)))).toEqual(
          Option.some(expect.objectContaining({ reason: "capacity" })));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(interrupting);
        const interrupted = yield* Fiber.await(work);
        expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
        expect(acquiring).toBe(false);
        expect(Result.getFailure(yield* Effect.result(borrowed.target.assertOpen))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
        expect(Result.getFailure(yield* Effect.result(borrowed.operation.transaction.get(first)))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
        yield* database.withQueryTarget(budget, target => evaluate(target, first));
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("fences target completion and refresh for accepted metadata before its write acknowledgement", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const saved = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let armed = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => fixture.persistence.write(lease, batch).pipe(
        Effect.andThen(Effect.suspend(() => {
          if (!armed) return Effect.void;
          armed = false;
          return Effect.andThen(Deferred.succeed(saved, undefined), Deferred.await(release));
        })),
      ) };
      const database = yield* openCoreDatabase(persistence, options);
      const { first } = yield* prepare(database);
      const evaluated = yield* database.withQueryTarget(budget, target => evaluate(target, first));
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        const operation = yield* target.beginQuery(path);
        yield* operation.transaction.get(first);
        armed = true;
        const publishing = yield* Effect.forkChild(database.publishPrograms({ programs: [{ identity: {
          functionPath: path, programHash: "accepted-replacement", schemaHash: "schema",
        }, metadata: {} }] }));
        yield* Deferred.await(saved);
        // The real durable write has completed, but ordered publication still
        // awaits its acknowledgement. Pending authority already fences reads.
        expect(yield* database.publishedTimestamp).toBe(target.timestamp);
        expect(Result.getFailure(yield* Effect.result(operation.finish()))).toEqual(Option.some(expect.objectContaining({ reason: "authorityRevoked" })));
        expect(Result.getFailure(yield* Effect.result(target.refresh(evaluated.token)))).toEqual(Option.some(expect.objectContaining({ reason: "authorityRevoked" })));
        expect(yield* database.publishedTimestamp).toBe(target.timestamp);
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(publishing)).timestamp).toBeGreaterThan(target.timestamp);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("rejects later and forged tokens rather than manufacturing validity", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      const { first } = yield* prepare(database);
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        yield* patch(database, first, 2);
        const latest = yield* database.beginQuery(path);
        yield* latest.transaction.get(first);
        const token = yield* latest.finish();
        expect(Result.getFailure(yield* Effect.result(target.refresh(token)))).toEqual(Option.some(expect.objectContaining({ reason: "invalidTarget" })));
        expect(Result.getFailure(yield* Effect.result(target.refresh({ ...token, timestamp: target.timestamp, reads: [] })))).toEqual(
          Option.some(expect.objectContaining({ reason: "invalidValue" })));
      }));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("rejects another live physical owner's target even when program identities match", async () => {
    const fixture = await createFixture();
    try {
      const otherFixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        const other = yield* openCoreDatabase(otherFixture.persistence, options);
        yield* prepare(database);
        yield* prepare(other);
        yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
          yield* target.assertOpen;
          yield* database.assertQueryTarget(target);
          expect(Result.getFailure(yield* Effect.result(other.assertQueryTarget(target)))).toEqual(
            Option.some(expect.objectContaining({ reason: "invalidValue" })));
        }));
      }))); } finally { await otherFixture.close(); }
    } finally { await fixture.close(); }
  }, 30_000);

  it("fences current program authority without rejecting an older valid data snapshot", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      const { first } = yield* prepare(database);
      const evaluated = yield* database.withQueryTarget(budget, target => evaluate(target, first));
      yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
        const operation = yield* target.beginQuery(path);
        yield* database.publishPrograms({ programs: [{ identity: { functionPath: path, programHash: "replacement", schemaHash: "schema" }, metadata: {} }] });
        expect(Option.getOrThrow(yield* operation.transaction.get(first)).value).toBe(1);
        expect(Result.getFailure(yield* Effect.result(operation.finish()))).toEqual(Option.some(expect.objectContaining({ reason: "authorityRevoked" })));
        expect(Result.getFailure(yield* Effect.result(target.refresh(evaluated.token)))).toEqual(Option.some(expect.objectContaining({ reason: "authorityRevoked" })));
      }));
      const buffered = yield* Effect.result(database.withQueryTarget(budget, target => Effect.gen(function* () {
        const evaluation = yield* evaluate(target, first);
        yield* database.publishPrograms({ programs: [{ identity: { functionPath: path, programHash: "another", schemaHash: "schema" }, metadata: {} }] });
        return evaluation.value;
      })));
      expect(Result.getFailure(buffered)).toEqual(Option.some(expect.objectContaining({ reason: "authorityRevoked" })));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("advances checked metadata frontiers on consecutive clean refreshes beyond the original log window", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      let now = 1_000_000_000n;
      const database = yield* openCoreDatabase(fixture.persistence, { ...options, now: Effect.sync(() => now) });
      const { first, second } = yield* prepare(database);
      let token = (yield* database.withQueryTarget(budget, target => evaluate(target, first))).token;
      const originalTimestamp = token.timestamp;
      for (let iteration = 0; iteration < 6; iteration += 1) {
        now += 70_000_000_000n;
        yield* patch(database, second, 20 + iteration);
        token = yield* database.withQueryTarget(budget, target => Effect.map(target.refresh(token), Option.getOrThrow));
        expect(token.metadataReadFrontiers?.every(frontier => frontier.timestamp === token.timestamp)).toBe(true);
      }
      expect(token.timestamp - originalTimestamp).toBeGreaterThan(300_000_000_000n);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("reports retained-log loss and foreign cold-owner tokens explicitly", async () => {
    const fixture = await createFixture();
    let token: CoreReadToken | undefined;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let now = 1_000_000_000n;
        const database = yield* openCoreDatabase(fixture.persistence, { ...options, now: Effect.sync(() => now) });
        const { first } = yield* prepare(database);
        token = (yield* database.withQueryTarget(budget, target => evaluate(target, first))).token;
        yield* patch(database, first, 2);
        now += 301_000_000_000n;
        yield* patch(database, first, 3);
        yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
          if (token === undefined) throw new Error("Missing prior query token");
          expect(Result.getFailure(yield* Effect.result(target.refresh(token)))).toEqual(Option.some(expect.objectContaining({ reason: "outOfRetention" })));
        }));
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        yield* database.withQueryTarget(budget, target => Effect.gen(function* () {
          if (token === undefined) throw new Error("Missing prior query token");
          expect(Result.getFailure(yield* Effect.result(target.refresh(token)))).toEqual(Option.some(expect.objectContaining({ reason: "invalidValue" })));
        }));
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("rechecks the deadline after I/O and refuses late result disclosure", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const liveClock = yield* Effect.clockWith(clock => Effect.succeed(clock));
      let monotonic = 0n, armed = false;
      const clock: Clock.Clock = { currentTimeMillisUnsafe: () => liveClock.currentTimeMillisUnsafe(), currentTimeMillis: liveClock.currentTimeMillis,
        currentTimeNanosUnsafe: () => liveClock.currentTimeNanosUnsafe(), currentTimeNanos: liveClock.currentTimeNanos,
        monotonicTimeNanosUnsafe: () => monotonic, monotonicTimeNanos: Effect.sync(() => monotonic), sleep: duration => liveClock.sleep(duration) };
      const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (timestamp, retention) => fixture.persistence.readSnapshot(timestamp, retention).pipe(
        Effect.map(snapshot => ({ ...snapshot, scan: request => snapshot.scan(request).pipe(Effect.tap(() => Effect.sync(() => {
          if (armed) monotonic = 11_000_000_000n;
        }))) }))) };
      const database = yield* openCoreDatabase(persistence, options);
      const { first } = yield* prepare(database);
      const outcome = yield* Effect.result(database.withQueryTarget(budget, target => Effect.gen(function* () {
        const operation = yield* target.beginQuery(path);
        armed = true;
        return yield* operation.transaction.get(first);
      })).pipe(Effect.provideService(Clock.Clock, clock)));
      expect(Result.getFailure(outcome)).toEqual(Option.some(expect.objectContaining({ reason: "admissionExpired" })));
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("rechecks durable retention after a consumed physical page", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      let lost = false, armed = false;
      const validate = (at: bigint) => lost ? Effect.fail(new CorePersistenceError({ reason: "outOfRetention" }))
        : fixture.persistence.retentionValidator.validateDocument(at);
      const persistence: CorePersistence = { ...fixture.persistence, retentionValidator: {
        validateDocument: validate, validateIndex: validate,
      }, readSnapshot: (timestamp, retention) => fixture.persistence.readSnapshot(timestamp, retention).pipe(Effect.map(snapshot => ({ ...snapshot,
        scan: request => snapshot.scan(request).pipe(Effect.tap(() => Effect.sync(() => { if (armed) lost = true; }))),
      }))) };
      const database = yield* openCoreDatabase(persistence, options);
      const { first } = yield* prepare(database);
      const outcome = yield* Effect.result(database.withQueryTarget(budget, target => Effect.gen(function* () {
        const operation = yield* target.beginQuery(path);
        armed = true;
        return yield* operation.transaction.get(first);
      })));
      expect(Result.getFailure(outcome)).toEqual(Option.some(expect.objectContaining({ reason: "outOfRetention" })));
    }))); } finally { await fixture.close(); }
  }, 30_000);
});
}
