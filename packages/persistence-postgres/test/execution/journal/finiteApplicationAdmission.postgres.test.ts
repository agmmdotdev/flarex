import { Effect, Fiber } from "effect";
import { CommitSyscallSequenceV1Schema, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createApplicationNativeMutationPostgresFixture } from "../../application/applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { FINITE_INDEXED_QUERY_OPTIONS, makeFiniteIndexedQueriesHarness } from "./finiteIndexedQueriesScenario";
import { finiteApplicationAdmissionScenario } from "./finiteApplicationAdmissionScenario";
import { privatePermissionFixture } from "../../application/ownership/privatePermissionFixture";
import { finitePrivateApplicationAdmissionScenario, seedFinitePrivateAdmissionPermissions } from "./finitePrivateApplicationAdmissionScenario";

describe.skipIf(postgresUrl === null)("finite Application operation admission on ordinary PostgreSQL", () => {
  it("freshly admits local values and receipt replays", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({}, {}, "finiteCapture")),
      owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
    const control = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture()),
      owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
    expect((yield* Effect.tryPromise(() => target.persistence.query<{ superuser: boolean; bypass: boolean }>(
      "select rolsuper as superuser,rolbypassrls as bypass from pg_roles where rolname=current_user"))).rows)
      .toEqual([{ superuser: false, bypass: false }]);
    const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPostgresFixture(FINITE_INDEXED_QUERY_OPTIONS,
      { control: control.persistence, target: target.persistence }));
    yield* finiteApplicationAdmissionScenario(native);
  }))), 120_000);

  it("freshly admits eligible protected Application commands and permission replays", () => runEffect(Effect.scoped(Effect.gen(function* () {
    const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({}, {}, "finiteCapture")),
      owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
    const fixture = yield* Effect.acquireRelease(Effect.tryPromise(() => privatePermissionFixture(target.persistence)),
      owner => Effect.tryPromise(() => owner.close()).pipe(Effect.orDie));
    yield* finitePrivateApplicationAdmissionScenario(fixture, target.persistence);
  }))), 180_000);

  for (const mode of ["expired", "live", "freeze"] as const) {
    it(`holds one operation lifetime across a genuine authority lock wait: ${mode}`, () => runEffect(Effect.scoped(Effect.gen(function* () {
      const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({}, {}, "finiteCapture")),
        owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
      const control = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture()),
        owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
      const native = yield* Effect.tryPromise(() => createApplicationNativeMutationPostgresFixture(FINITE_INDEXED_QUERY_OPTIONS,
        { control: control.persistence, target: target.persistence }));
      const harness = yield* makeFiniteIndexedQueriesHarness(native);
      // The actual activation owner issues the configured deadline. The
      // header must sample database time after the wait rather than entry time.
      const entry = yield* harness.open({ executionClaimDurationMilliseconds: mode === "expired" ? 5_000 : 60_000 });
      const blocker = yield* Effect.acquireRelease(Effect.tryPromise(async () => {
        const client = await target.persistence.pool.connect();
        try {
          await client.query("begin");
          await client.query("select 1 from fx_system_scope_execution_authority where scope_id=$1 for update", [native.authority.scopeId]);
          const result = await client.query<{ pid: number }>("select pg_backend_pid()::int as pid");
          const pid = result.rows[0]?.pid;
          if (pid === undefined) throw new Error("Missing actual blocker backend");
          return { client, pid, released: false };
        } catch (cause) { client.release(); throw cause; }
      }), owner => Effect.tryPromise(async () => {
        try { if (!owner.released) await owner.client.query("rollback"); }
        finally { owner.client.release(); }
      }).pipe(Effect.orDie));
      const operation = harness.store.runApplicationPointOperationEffect(entry.attempt, "users",
        { kind: "get", documentId: harness.alphaId, syscallSequence: CommitSyscallSequenceV1Schema.make(1n) }, entry.validator);
      let successfulDeliveries = 0;
      const pending = yield* Effect.forkChild(Effect.exit(operation.pipe(Effect.tap(() =>
        Effect.sync(() => { successfulDeliveries += 1; })))));
      yield* waitForPostgresPredicate(target.persistence.pool,
        "select exists(select 1 from pg_stat_activity a where $1::int=any(pg_blocking_pids(a.pid))) as satisfied", [blocker.pid]);
      expect((yield* Effect.tryPromise(() => target.persistence.query<{ live: boolean }>(
        "select clock_timestamp() < finite_claim_expires_at as live from fx_system_tx_session where session_id=$1",
        [entry.activation.anchor.sessionId]))).rows[0]?.live, "Actual header wait must be observed before claim expiry").toBe(true);
      if (mode === "expired") {
        yield* waitForPostgresPredicate(target.persistence.pool,
          "select clock_timestamp() >= finite_claim_expires_at as satisfied from fx_system_tx_session where session_id=$1", [entry.activation.anchor.sessionId]);
      } else if (mode !== "live") {
        expect(yield* Effect.flip(harness.store.freezeFiniteRootEffect(entry.attempt,
          yield* canonicalizeSuccessfulResultV1Effect(null)))).toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      }
      yield* Effect.tryPromise(async () => { await blocker.client.query("commit"); blocker.released = true; });
      const outcome = yield* Fiber.join(pending);
      if (mode === "expired") {
        expect(outcome).toMatchObject({ _tag: "Failure", cause: { reasons: [expect.objectContaining({ _tag: "Fail",
          error: expect.objectContaining({ _tag: "SessionJournalAttemptUnavailableV1Error", issue: { reason: "activeAttemptExpired" } }) })] } });
      } else if (mode === "live") {
        expect(outcome).toMatchObject({ _tag: "Success", value: { kind: "completed", outcome: { kind: "present" } } });
        expect(successfulDeliveries).toBe(1);
        expect((yield* harness.freeze(entry)).view.operations).toHaveLength(1);
      } else {
        expect(outcome).toMatchObject({ _tag: "Failure", cause: { reasons: [expect.objectContaining({ _tag: "Fail",
          error: expect.objectContaining({ _tag: "SessionJournalStorageCorruptionV1Error", reason: "journalStateInvalid" }) })] } });
        expect(yield* Effect.flip(harness.store.freezeFiniteRootEffect(entry.attempt,
          yield* canonicalizeSuccessfulResultV1Effect(null)))).toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      }
      if (mode !== "live") expect(successfulDeliveries).toBe(0);
    }))), 120_000);
  }

  for (const mode of ["preparation", "permissions"] as const) it(`retains eligible private ${mode} lifetime while admission waits`,
    () => runEffect(Effect.scoped(Effect.gen(function* () {
      const target = yield* Effect.acquireRelease(Effect.tryPromise(() => createFileScopedPostgresFixture({}, {}, "finiteCapture")),
        owner => Effect.tryPromise(owner.dispose).pipe(Effect.orDie));
      const fixture = yield* Effect.acquireRelease(Effect.tryPromise(() => privatePermissionFixture(target.persistence)),
        owner => Effect.tryPromise(() => owner.close()).pipe(Effect.orDie));
      const documentId = yield* seedFinitePrivateAdmissionPermissions(fixture);
      const root = yield* Effect.tryPromise(() => fixture.open());
      const blocker = yield* Effect.acquireRelease(Effect.tryPromise(async () => {
        const client = await target.persistence.pool.connect();
        try {
          await client.query("begin");
          await client.query("select 1 from fx_system_scope_execution_authority where scope_id=$1 for update", [fixture.application.authority.scopeId]);
          const pid = (await client.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
          if (pid === undefined) throw new Error("Missing private admission blocker backend");
          return { client, pid, released: false };
        } catch (cause) { client.release(); throw cause; }
      }), owner => Effect.tryPromise(async () => {
        try { if (!owner.released) await owner.client.query("rollback"); }
        finally { owner.client.release(); }
      }).pipe(Effect.orDie));
      const operation: Effect.Effect<unknown, unknown> = mode === "preparation"
        ? fixture.store.preparePrivateApplicationCommandEffect(root.attempt, "audit")
        : fixture.store.readPrivateReferencePermissionsEffect(root.attempt,
          { tableName: "audit", documentId, syscallSequence: CommitSyscallSequenceV1Schema.make(1n), principal: root.principal }, root.validator);
      let successfulDeliveries = 0;
      const pending = yield* Effect.forkChild(Effect.exit(operation.pipe(Effect.tap(() =>
        Effect.sync(() => { successfulDeliveries += 1; })))));
      yield* waitForPostgresPredicate(target.persistence.pool,
        "select exists(select 1 from pg_stat_activity a where $1::int=any(pg_blocking_pids(a.pid))) as satisfied", [blocker.pid]);
      expect(yield* Effect.flip(fixture.store.freezeFiniteRootEffect(root.attempt, yield* canonicalizeSuccessfulResultV1Effect(null))))
        .toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      yield* Effect.tryPromise(async () => { await blocker.client.query("commit"); blocker.released = true; });
      const outcome = yield* Fiber.join(pending);
      expect(outcome).toMatchObject({ _tag: "Failure", cause: { reasons: [expect.objectContaining({ _tag: "Fail",
        error: expect.objectContaining(mode === "preparation"
          ? { _tag: "InvalidSessionJournalCapabilityV1Error", capability: "attempt" }
          : { _tag: "PrivatePermissionEvidenceError", reason: "invalidAuthority" }) })] } });
      expect(successfulDeliveries).toBe(0);
      expect(yield* Effect.flip(fixture.store.freezeFiniteRootEffect(root.attempt, yield* canonicalizeSuccessfulResultV1Effect(null))))
        .toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
    }))), 180_000);
});

/** Polls evidence, never elapsed sleep as the proof. The deadline only bounds a
 * failed fixture; pg_blocking_pids and clock_timestamp establish both premises. */
const waitForPostgresPredicate = Effect.fn("FiniteApplicationAdmission.waitForPostgresEvidence")(
  function* (pool: Pool, statement: string, parameters: readonly unknown[]) {
    const deadline = (yield* Effect.clockWith(clock => clock.currentTimeMillis)) + 15_000;
    while (true) {
      const result = yield* Effect.tryPromise(() => pool.query<{ satisfied: boolean }>(statement, [...parameters]));
      if (result.rows[0]?.satisfied === true) return;
      if ((yield* Effect.clockWith(clock => clock.currentTimeMillis)) >= deadline) return yield* Effect.die(new Error("PostgreSQL evidence did not become true"));
      yield* Effect.sleep("10 millis");
    }
  },
);
