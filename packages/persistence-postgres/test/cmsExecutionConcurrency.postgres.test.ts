import { Clock, Deferred, Effect, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { runEffect } from "./effectTestRuntime";

const decodePid = Schema.decodeUnknownSync(Schema.Int.check(Schema.isGreaterThan(0)));
const decodeBlockers = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ pid: Schema.Int, shared: Schema.Boolean })));
const decodeRole = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ superuser: Schema.Boolean })));
const decodeDocuments = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ _id: Schema.String })));

// Existing hook after the publication prefix, before clock advancement/COMMIT.
// Only the first publication waits; later writes and replay use the same host.
const makePublicationBarrier = Effect.fn(function* () {
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  let first = true;
  return {
    entered: Deferred.await(entered).pipe(Effect.timeout("10 seconds")),
    open: Deferred.succeed(release, undefined),
    isOpen: Deferred.isDone(release),
    hooks: { afterPreferenceFacts: Effect.fn(function* () {
      if (!first) return;
      first = false;
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    }) },
  };
});

const waitForScopeClockWaiter = Effect.fn(function* (persistence: PostgresFlarexPersistence, holderPid: number) {
  const deadline = (yield* Clock.monotonicTimeNanos) + 5_000_000_000n;
  while ((yield* Clock.monotonicTimeNanos) < deadline) {
    const result = yield* Effect.tryPromise({
      try: () => persistence.query(`select pid, position('for share' in lower(query))>0 as shared
        from pg_stat_activity where datname=current_database() and wait_event_type='Lock'
        and $1::int=any(pg_blocking_pids(pid)) and position('fx_system_scope_clock' in query)>0`, [holderPid]),
      catch: cause => new Error("Could not observe PostgreSQL scope-clock wait", { cause }),
    });
    const rows = yield* decodeBlockers(result.rows);
    const waiter = rows[0];
    if (waiter !== undefined) return waiter;
    yield* Effect.sleep("10 millis");
  }
  return yield* Effect.fail(new Error("Competing CMS request never waited on the held scope clock"));
});

describe.skipIf(postgresUrl === null)("active CMS request concurrency", () => {
  const withPersistence = useFileScopedPostgresPersistence();

  it("settles another active scope over shared physical families while a publication is held", () => withPersistence(async persistence => {
    expect(decodeRole((await persistence.query("select rolsuper as superuser from pg_roles where rolname=current_user")).rows))
      .toEqual([{ superuser: false }]);
    const barrier = await runEffect(makePublicationBarrier());
    const first = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence), barrier.hooks);
    const second = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence));
    expect(first.scope.scopeUuid).not.toBe(second.scope.scopeUuid);
    const beforeFirst = await first.inventory();
    const beforeSecond = await second.inventory();
    // Same logical IDs, unique key and request key in different scopes. Both
    // hosts use this exact database/pool and the same physical table families.
    expect(beforeFirst.builds.map(build => build.indexDefinitionId)).toEqual(beforeSecond.builds.map(build => build.indexDefinitionId));
    expect(beforeFirst.uniqueBuilds.map(build => build.uniqueConstraintDefinitionId)).toEqual(beforeSecond.uniqueBuilds.map(build => build.uniqueConstraintDefinitionId));
    const key = first.host.newRequestKey();
    const args = { count: 1, prefix: "shared-natural-key" };
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const held = yield* first.host.run(key, first.insert, args).pipe(Effect.forkScoped);
      yield* barrier.entered;
      const secondValue = yield* second.host.run(key, second.insert, args).pipe(Effect.timeout("10 seconds"));
      expect(yield* barrier.isOpen).toBe(false);
      expect(yield* Effect.promise(() => first.inventory())).toEqual(beforeFirst);
      const afterSecond = yield* Effect.promise(() => second.verifyInsert(beforeSecond, secondValue, 1, args.prefix));
      yield* barrier.open;
      const firstValue = yield* Fiber.join(held);
      yield* Effect.promise(() => first.verifyInsert(beforeFirst, firstValue, 1, args.prefix));
      expect(yield* Effect.promise(() => second.inventory())).toEqual(afterSecond);
      expect(firstValue).not.toEqual(secondValue);
      const firstIds = decodeDocuments(firstValue).map(document => document._id);
      const secondIds = decodeDocuments(secondValue).map(document => document._id);
      expect(yield* first.host.read(first.read, secondIds)).toEqual([null]);
      expect(yield* second.host.read(second.read, firstIds)).toEqual([null]);
      expect(yield* first.host.run(key, first.insert, args)).toEqual(firstValue);
      expect(yield* second.host.run(key, second.insert, args)).toEqual(secondValue);
      expect(first.executionCount()).toBe(1);
      expect(second.executionCount()).toBe(1);
    }).pipe(Effect.ensuring(barrier.open), Effect.timeout("20 seconds"))));
    expect(persistence.pool.waitingCount).toBe(0);
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);

  it.each(["independent", "duplicate"] as const)("observes same-scope blocking and correct %s settlement", mode => withPersistence(async persistence => {
    const barrier = await runEffect(makePublicationBarrier());
    let activePid = 0;
    const session = makePostgresRelationalSession(persistence, { lifecycleFault: event => {
      if (event.phase === "begin" && event.edge === "after") activePid = decodePid(Reflect.get(event.client, "processID"));
    } });
    const tested = await cmsExecutionMeasurementFixture(persistence, session, barrier.hooks);
    const before = await tested.inventory();
    const key = tested.host.newRequestKey();
    const args = { count: 1, prefix: "held-key" };
    const otherKey = mode === "duplicate" ? key : tested.host.newRequestKey();
    const otherArgs = mode === "duplicate" ? args : { count: 1, prefix: "independent-key" };
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const held = yield* tested.host.run(key, tested.insert, args).pipe(Effect.forkScoped);
      yield* barrier.entered;
      const holderPid = activePid;
      expect(holderPid).toBeGreaterThan(0);
      const competing = yield* tested.host.run(otherKey, tested.insert, otherArgs).pipe(Effect.forkScoped);
      const waiter = yield* waitForScopeClockWaiter(persistence, holderPid);
      expect(waiter.pid).not.toBe(holderPid);
      // Current admission blocks during its preparatory shared clock read,
      // before it reaches the main transaction or the second command callback.
      expect(waiter.shared).toBe(true);
      expect(tested.executionCount()).toBe(1);
      expect(yield* Effect.promise(() => tested.inventory())).toEqual(before);
      yield* barrier.open;
      const firstValue = yield* Fiber.join(held);
      const secondValue = yield* Fiber.join(competing);
      if (mode === "duplicate") expect(secondValue).toEqual(firstValue);
      else expect(secondValue).not.toEqual(firstValue);
      for (const value of [firstValue, secondValue]) {
        expect(yield* tested.host.read(tested.read, decodeDocuments(value).map(document => document._id))).toEqual(value);
      }
      const count = mode === "duplicate" ? 1 : 2;
      const after = yield* Effect.promise(() => tested.inventory());
      for (const family of ["rows", "revisions", "claims", "facts", "commits", "outcomes", "wakes"] as const) {
        expect(after[family].length - before[family].length).toBe(count);
      }
      expect(after.indexes.length - before.indexes.length).toBe(count * 2);
      expect(after.indexRevisions.length - before.indexRevisions.length).toBe(count * 2);
      expect(after.clock[0]?.lastCommitSeq).toBe((before.clock[0]?.lastCommitSeq ?? -1n) + BigInt(count));
      expect(after.commits.slice(before.commits.length).map(commit => commit.commitSeq))
        .toEqual(Array.from({ length: count }, (_, index) => (before.clock[0]?.lastCommitSeq ?? -1n) + BigInt(index + 1)));
      expect(after.builds).toEqual(before.builds);
      expect(after.uniqueBuilds).toEqual(before.uniqueBuilds);
      expect(after.sessions).toEqual(before.sessions);
      expect(tested.executionCount()).toBe(count);
      expect(yield* tested.host.run(otherKey, tested.insert, otherArgs)).toEqual(secondValue);
      expect(tested.executionCount()).toBe(count);
      expect(yield* Effect.promise(() => tested.inventory())).toEqual(after);
    }).pipe(Effect.ensuring(barrier.open), Effect.timeout("20 seconds"))));
    expect(persistence.pool.waitingCount).toBe(0);
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);
});
