import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { runEffect } from "../../support/effectTestRuntime";

const decodePid = Schema.decodeUnknownSync(Schema.Int.check(Schema.isGreaterThan(0)));
const decodeBlockers = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ pid: Schema.Int, shared: Schema.Boolean })));
const decodeRole = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ superuser: Schema.Boolean })));
const decodeDocuments = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ _id: Schema.String })));
const decodeTransactionPresence = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ active: Schema.Boolean })));

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

const waitForCommandWaiter = Effect.fn(function* (persistence: PostgresFlarexPersistence, holderPid: number, duplicate: boolean) {
  const deadline = (yield* Clock.monotonicTimeNanos) + 5_000_000_000n;
  while ((yield* Clock.monotonicTimeNanos) < deadline) {
    const result = yield* Effect.tryPromise({
      try: () => persistence.query(`select pid, position('for share' in lower(query))>0 as shared
        from pg_stat_activity where datname=current_database() and wait_event_type='Lock'
        and $1::int=any(pg_blocking_pids(pid)) and position($2 in query)>0`,
        [holderPid, duplicate ? "pg_advisory_xact_lock" : "fx_system_scope_clock"]),
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

  it("admits concurrent same-scope reads while publication commits", () => withPersistence(async persistence => {
    expect(decodeRole((await persistence.query("select rolsuper as superuser from pg_roles where rolname=current_user")).rows))
      .toEqual([{ superuser: false }]);
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    let holdNextAdmission = false;
    const session = makePostgresRelationalSession(persistence);
    const tested = await cmsExecutionMeasurementFixture(persistence, session, {
      afterAdmission: Effect.fn(function* () {
        if (!holdNextAdmission) return;
        holdNextAdmission = false;
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      }),
    });
    const seeded = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "shared-read" }));
    const ids = decodeDocuments(seeded).map(document => document._id);
    const before = await tested.inventory();
    const key = tested.host.newRequestKey();
    const args = { count: 1, prefix: "after-shared-read" };
    holdNextAdmission = true;
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const first = yield* tested.host.read(tested.read, ids).pipe(Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
      // This must finish while the first read still owns its admission locks.
      expect(yield* tested.host.read(tested.read, ids)).toEqual(seeded);
      expect(yield* Deferred.isDone(release)).toBe(false);
      const value = yield* tested.host.run(key, tested.insert, args);
      expect(yield* Deferred.isDone(release)).toBe(false);
      expect(tested.executionCount()).toBe(2);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toEqual(seeded);
      const after = yield* Effect.promise(() => tested.verifyInsert(before, value, 1, args.prefix));
      expect(yield* tested.host.run(key, tested.insert, args)).toEqual(value);
      expect(tested.executionCount()).toBe(2);
      expect(yield* Effect.promise(() => tested.inventory())).toEqual(after);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
    expect(persistence.pool.waitingCount).toBe(0);
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);

  it("reads through an uncommitted same-scope publication", () => withPersistence(async persistence => {
    const barrier = await runEffect(makePublicationBarrier());
    let armed = false;
    const tested = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence), {
      afterPreferenceFacts: () => armed ? barrier.hooks.afterPreferenceFacts() : Effect.void,
    });
    const seeded = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "before-held" }));
    const ids = decodeDocuments(seeded).map(document => document._id);
    const before = await tested.inventory();
    armed = true;
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const held = yield* tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "held-new" }).pipe(Effect.forkScoped);
      yield* barrier.entered;
      expect(yield* tested.host.read(tested.read, ids)).toEqual(seeded);
      expect(yield* barrier.isOpen).toBe(false);
      expect(yield* Effect.promise(() => tested.inventory())).toEqual(before);
      yield* barrier.open;
      const value = yield* Fiber.join(held);
      yield* Effect.promise(() => tested.verifyInsert(before, value, 1, "held-new"));
    }).pipe(Effect.ensuring(barrier.open), Effect.timeout("20 seconds"))));
  }), 120_000);

  it("expires a stalled publication through the physical owner and permits explicit retry after rollback", () => withPersistence(async persistence => {
    let activePid = 0;
    const session = makePostgresRelationalSession(persistence, { lifecycleFault: event => {
      if (event.phase === "begin" && event.edge === "after") activePid = decodePid(Reflect.get(event.client, "processID"));
    } });
    let stalled = false;
    let finalized = false;
    const tested = await cmsExecutionMeasurementFixture(persistence, session, {
      afterPreferenceFacts: Effect.fn(function* () {
        if (stalled) return;
        stalled = true;
        yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => { finalized = true; })));
      }),
    });
    const before = await tested.inventory();
    const key = tested.host.newRequestKey();
    const args = { count: 1, prefix: "deadline-rollback" };
    // Reserve an independent observer before the request acquires its client.
    // A later pool checkout could otherwise reuse a client with a leaked transaction.
    const observer = await persistence.pool.connect();
    try {
      const observerPid = decodePid(Reflect.get(observer, "processID"));
      // The outer watchdog cannot cause the expected failure. The physical
      // session owns its real ten-second deadline; no shortened test policy.
      const outcome = await runEffect(tested.host.run(key, tested.insert, args).pipe(Effect.exit, Effect.timeout("20 seconds")));
      expect(stalled).toBe(true);
      expect(finalized).toBe(true);
      if (Exit.isSuccess(outcome)) throw new Error("Stalled publication unexpectedly committed");
      const failure = Cause.findErrorOption(outcome.cause);
      if (Option.isNone(failure)) throw new Error("Missing physical deadline failure");
      expect(failure.value).toMatchObject({ reason: "resourceFailure", cause: {
        _tag: "RelationalSessionError", reason: "resourceFailure", cause: {
          _tag: "PhysicalSessionResourceIssue", phase: "callback", cause: {
            _tag: "PhysicalSessionDeadlineIssue", deadlineKind: "initial", phase: "callback",
          },
        },
      } });
      expect(activePid).toBeGreaterThan(0);
      expect(activePid).not.toBe(observerPid);
      const backend = await observer.query("select exists(select 1 from pg_stat_activity where pid=$1 and xact_start is not null) as active", [activePid]);
      expect(decodeTransactionPresence(backend.rows)).toEqual([{ active: false }]);
    } finally {
      observer.release();
    }
    expect(tested.executionCount()).toBe(1);
    expect(await tested.inventory()).toEqual(before);
    expect(persistence.pool.waitingCount).toBe(0);
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
    const value = await runEffect(tested.host.run(key, tested.insert, args));
    const after = await tested.verifyInsert(before, value, 1, args.prefix);
    expect(tested.executionCount()).toBe(2);
    expect(await runEffect(tested.host.run(key, tested.insert, args))).toEqual(value);
    expect(tested.executionCount()).toBe(2);
    expect(await tested.inventory()).toEqual(after);
  }), 120_000);

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

  it.each(["independent", "duplicate"] as const)("separates publication and request exclusion for %s settlement", mode => withPersistence(async persistence => {
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
      const waiter = yield* waitForCommandWaiter(persistence, holderPid, mode === "duplicate");
      expect(waiter.pid).not.toBe(holderPid);
      // Independent callbacks finish before waiting for publication; duplicates
      // wait on their request key before entering any callback.
      expect(waiter.shared).toBe(false);
      expect(tested.executionCount()).toBe(mode === "duplicate" ? 1 : 2);
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
