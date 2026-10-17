import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Result } from "effect";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowRequestCancellation, decideTrustedWorkflowCompleteAttempt,
  decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1, decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowCallbackJournal, type TrustedWorkflowCallbackDefinition } from "../../src/tasks/trustedWorkflowCallback";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../src/tasks/trustedWorkflowTaskRunCreation";
import { issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject, revokeTrustedWorkflowExecutionSubject,
  type TrustedWorkflowExecutionSubject } from "../../src/tasks/trustedWorkflowExecutionSubject";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "../../src/tasks/taskSystemRunAttemptStoreV1";
import { fxSystemDurableTaskRunsV1, fxSystemExternalEffectAttemptsV1 as effects } from "../../src/database/schema";
import { createPGlitePersistence, createPGliteLocatedTaskSystemRunAttemptTargetV1, createPGliteDeadlineOwnedTaskPersistenceTarget } from "../../src/database/pglite";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from "../../src/database/postgres";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../src/tasks/postgresTaskExternalEffectAuthority";
import type { DeadlineOwnedTaskPersistenceTarget } from "../../src/tasks/taskPersistenceTransaction";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../support/pgliteTestFixture";
import { withTemporaryPostgresPersistence } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";
import { locatedTaskAuthorityV1, readyTaskRunAggregateV1, TASK_LOCATOR } from "./taskSystemRunAttemptStoreTestSupport";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
beforeAll(async () => { if (driver !== "postgres") await migratedPGliteDataDir(); }, 120_000);
const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
  statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
const definition: TrustedWorkflowCallbackDefinition = { id: "native.local-feed", revision: "1".repeat(64),
  inputCodecRevision: "json.input.one", outcomeCodecRevision: "json.outcome.one", allowControl: false, maximumCallbackMs: 10_000 };

describe(`trusted workflow callback journal - ${driver}`, () => {
  it("rejects an arbitrary target before any callback or hash", async () => {
    const invoke = vi.fn(() => Effect.succeed({ kind: "returned" as const, value: null }));
    const sha256 = vi.fn(hash);
    const attempted = makeTrustedWorkflowCallbackJournal({ target: {} as DeadlineOwnedTaskPersistenceTarget,
      // Deliberately invalid remaining configuration must never be observed.
      get authority(): never { throw new Error("not reached"); }, get binding(): never { throw new Error("not reached"); },
      definition, sha256 }, invoke);
    expect(await runEffect(Effect.result(attempted))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
    expect(invoke).not.toHaveBeenCalled(); expect(sha256).not.toHaveBeenCalled();
  });

  it("settles known tagged outcomes, replays without dispatch, rejects conflicts, preserves Cause, and fences late results", async () => {
    await withFixture(async ({ db, target, transactionTarget }) => {
      const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
      await insertCurrentScopeClockFixture(db, { scopeId, epoch: `epoch_${randomUUID()}` });
      const located = await locatedTaskAuthorityV1(db, target, scopeId, "callback-test");
      const principalValue = await runEffect(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
        executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|callback", subject: "callback", issuer: "issuer", roles: [] } } }));
      const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(principalValue.sha256, principalValue.canonicalBytes.byteLength));
      const binding = await runEffect(prepareTrustedWorkflowTaskBinding({ scopeId, workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64),
        executionProfile: "callback-test", executionPolicy: { callback: definition.id }, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
        boundPolicy: { ...readyTaskRunAggregateV1().boundPolicy, leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)) } }, hash));
      const creation = makeTrustedWorkflowTaskRunCreationStore({ authority: located.authority, target: transactionTarget, binding, sha256: hash });
      const run = await runEffect(creation.createRun({ requestKey: "callback", principal,
        input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(2), 1)) }));
      const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
      const initial = await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: run.runId }));
      const started = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: run.runId,
        decide: current => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: run.runId, expectedRunVersion: initial.current.runVersion,
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)) }, current) }));
      if (started.outcome.kind !== "attempt_granted") throw new Error("Expected attempt grant");
      const identity = { runId: run.runId, ...started.outcome.grant.attempt };
      await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: run.runId,
        decide: current => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: run.runId, attemptId: identity.attemptId,
          executionFence: identity.executionFence, heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, current) }));
      const subjectOptions = { authority: located.authority, target: transactionTarget, binding, principal,
        principalCanonicalBytes: principalValue.canonicalBytes, sha256: hash };
      const subject = await runEffect(issueTrustedWorkflowExecutionSubject(identity, subjectOptions));
      const options = { authority: located.authority, target: transactionTarget, binding, definition, sha256: hash };
      let definitionReads = 0;
      const badDefinition = Object.defineProperty({ ...definition }, "id", { enumerable: true,
        get() { definitionReads++; throw new Error("Must not invoke definition getters"); } });
      expect(await runEffect(Effect.result(makeTrustedWorkflowCallbackJournal({ ...options, definition: badDefinition },
        () => Effect.succeed({ kind: "returned" as const, value: null }))))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(definitionReads).toBe(0);
      const calls = vi.fn();
      const journal = await runEffect(makeTrustedWorkflowCallbackJournal(options, value => Effect.gen(function* () {
        calls(value);
        // A genuine independent transaction can lock the Task row NOWAIT while
        // the callback runs: neither phase SQL transaction spans this callback.
        yield* Effect.tryPromise({ try: () => db.transaction(tx => tx.select().from(fxSystemDurableTaskRunsV1).where(
          eq(fxSystemDurableTaskRunsV1.runId, run.runId)).for("update", { noWait: true })), catch: cause => cause });
        return { kind: "returned" as const, value };
      })));
      let forgedReads = 0;
      // Deliberate nominal forgery: the registry, never this assertion or shape,
      // must authenticate before any effect declaration or provider execution.
      const forged = { get runId() { forgedReads++; throw new Error("Must not inspect forged subject fields"); } } as unknown as TrustedWorkflowExecutionSubject;
      expect(await runEffect(Effect.result(journal.run(forged, 1n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
      expect(forgedReads).toBe(0); expect(calls).not.toHaveBeenCalled();
      expect(await runEffect(journal.run(subject, 1n, { message: "hello" }))).toEqual({ kind: "returned", value: { message: "hello" } });
      expect(await runEffect(journal.run(subject, 1n, { message: "hello" }))).toEqual({ kind: "returned", value: { message: "hello" } });
      expect(calls).toHaveBeenCalledTimes(1);
      expect(await runEffect(Effect.result(journal.run(subject, 1n, { message: "changed" })))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      const changed = await runEffect(makeTrustedWorkflowCallbackJournal({ ...options, definition: { ...definition, outcomeCodecRevision: "changed" } },
        () => Effect.succeed({ kind: "returned" as const, value: null })));
      expect(await runEffect(Effect.result(changed.run(subject, 1n, { message: "hello" })))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      const failed = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.succeed({ kind: "failed" as const, error: { code: "known", message: "provider rejected" } })));
      expect(await runEffect(failed.run(subject, 2n, null))).toEqual({ kind: "failed", error: { code: "known", message: "provider rejected" } });
      expect(await runEffect(failed.run(subject, 2n, null))).toEqual({ kind: "failed", error: { code: "known", message: "provider rejected" } });
      let getterReads = 0;
      const getter = { get value() { getterReads++; return "no"; } };
      expect(await runEffect(Effect.result(journal.run(subject, 3n, getter)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(getterReads).toBe(0);
      const providerError = new Error("infrastructure failure");
      const infrastructure = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.fail(providerError)));
      const providerFailure = await runEffect(Effect.result(infrastructure.run(subject, 4n, {})));
      expect(Result.isFailure(providerFailure)).toBe(true);
      if (Result.isFailure(providerFailure)) expect(providerFailure.failure).toBe(providerError);
      expect(await runEffect(Effect.result(infrastructure.run(subject, 4n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "uncertain" } });
      const defect = new Error("defect");
      const broken = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.die(defect)));
      const brokenExit = await runEffect(Effect.exit(broken.run(subject, 5n, {})));
      expect(brokenExit).toMatchObject({ _tag: "Failure" });
      if (Exit.isFailure(brokenExit)) expect(Cause.hasDies(brokenExit.cause)).toBe(true);
      const interrupted = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.interrupt));
      const interruptedExit = await runEffect(Effect.exit(interrupted.run(subject, 6n, {})));
      if (Exit.isFailure(interruptedExit)) expect(Cause.hasInterrupts(interruptedExit.cause)).toBe(true);
      else throw new Error("Expected callback interruption");
      const overdue = await runEffect(makeTrustedWorkflowCallbackJournal({ ...options, definition: { ...definition, maximumCallbackMs: 1 } },
        () => Effect.promise(async () => { await delay(30); return { kind: "returned" as const, value: "late" }; })));
      expect(await runEffect(Effect.result(overdue.run(subject, 7n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "deadlineExceeded" } });
      const missingError = { kind: "failed" as const, error: null };
      Reflect.deleteProperty(missingError, "error");
      let outcomeReads = 0;
      const getterError = Object.defineProperty({ kind: "failed" as const, error: null }, "error", { enumerable: true,
        get() { outcomeReads++; throw new Error("Must not invoke outcome getters"); } });
      for (const [ordinal, invalid] of [[10n, missingError], [11n, getterError]] as const) {
        const malformed = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.succeed(invalid)));
        expect(await runEffect(Effect.result(malformed.run(subject, ordinal, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidOutcome" } });
      }
      expect(outcomeReads).toBe(0);
      // Deliberate fixture corruption between phases verifies that settlement
      // reauthenticates exact retained input and policy before known output.
      const corruptInput = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => db.update(effects).set({ trustedCallbackInputJson: { corrupt: true } })
          .where(and(eq(effects.scopeId, scopeId), eq(effects.effectOrdinal, 12n))), catch: cause => cause });
        return { kind: "returned" as const, value: "must not settle" };
      })));
      expect(await runEffect(Effect.result(corruptInput.run(subject, 12n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      const corruptPolicy = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => db.update(effects).set({ trustedCallbackPolicyJson: { ...definition, revision: "corrupt" } })
          .where(and(eq(effects.scopeId, scopeId), eq(effects.effectOrdinal, 13n))), catch: cause => cause });
        return { kind: "returned" as const, value: "must not settle" };
      })));
      expect(await runEffect(Effect.result(corruptPolicy.run(subject, 13n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      const entered = await runEffect(Deferred.make<void>()), finish = await runEffect(Deferred.make<void>());
      let foreignCompleted = false;
      const delayed = await runEffect(makeTrustedWorkflowCallbackJournal(options, () => Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined); yield* Deferred.await(finish);
        return yield* Effect.promise(async () => { await delay(25); foreignCompleted = true; return { kind: "returned" as const, value: "revoked" }; });
      })));
      const pending = runEffect(Effect.result(delayed.run(subject, 8n, {})));
      await runEffect(Deferred.await(entered)); revokeTrustedWorkflowExecutionSubject(subject);
      await runEffect(Deferred.succeed(finish, undefined));
      expect(await pending).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
      expect(foreignCompleted).toBe(true);
      const rows = await db.select().from(effects).where(eq(effects.scopeId, scopeId));
      expect(rows.filter(row => row.state === "confirmed").map(row => row.effectOrdinal).sort()).toEqual([1n, 2n]);
      expect(rows.filter(row => row.state === "dispatching").map(row => row.effectOrdinal).sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
        .toEqual([4n, 5n, 6n, 7n, 8n, 10n, 11n, 12n, 13n]);
      expect(rows.filter(row => row.state === "dispatching").every(row => row.trustedCallbackOutcomeJson === null && row.trustedCallbackOutcomeSha256 === null)).toBe(true);
      const completed = await runEffect(lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: run.runId,
        decide: current => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity,
          completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
            retry: { kind: "override_delay", delayMs: Result.getOrThrow(decodeTaskDurationMsV1(1)) }, executionDurationMs: null } }, current) }));
      expect(completed.outcome.kind).toBe("retry_scheduled"); await delay(10);
      const retryState = await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: run.runId }));
      const retry = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: run.runId,
        decide: current => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: run.runId, expectedRunVersion: retryState.current.runVersion,
          retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)) }, current) }));
      if (retry.outcome.kind !== "attempt_granted") throw new Error("Expected retry attempt grant");
      const nextIdentity = { runId: run.runId, ...retry.outcome.grant.attempt };
      await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: run.runId,
        decide: current => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...nextIdentity,
          heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, current) }));
      const nextSubject = await runEffect(issueTrustedWorkflowExecutionSubject(nextIdentity, subjectOptions));
      expect(await runEffect(journal.run(nextSubject, 1n, { message: "hello" }))).toEqual({ kind: "returned", value: { message: "hello" } });
      expect(calls).toHaveBeenCalledTimes(1);
      expect(await runEffect(Effect.result(infrastructure.run(nextSubject, 4n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "uncertain" } });
      // A valid explicit unknown marker also cannot authorize redispatch.
      await db.update(effects).set({ state: "uncertain", settledAt: new Date(), terminalCode: "test-known-unknown" })
        .where(and(eq(effects.scopeId, scopeId), eq(effects.effectOrdinal, 4n)));
      expect(await runEffect(Effect.result(infrastructure.run(nextSubject, 4n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "uncertain" } });
      const retained = rows.find(row => row.effectOrdinal === 1n);
      if (retained?.trustedCallbackOutcomeSha256 === null || retained?.trustedCallbackOutcomeSha256 === undefined) throw new Error("Missing retained digest");
      const malformedStored: readonly Json[] = [{ kind: "failed" }, { error: "missing discriminator" },
        { kind: null, value: null }, { kind: "failed", error: null, extra: true }];
      for (const invalid of malformedStored) await expect(db.update(effects).set({ trustedCallbackOutcomeJson: invalid })
        .where(and(eq(effects.scopeId, scopeId), eq(effects.effectOrdinal, 1n)))).rejects.toMatchObject({ cause: { code: "23514" } });
      await db.update(effects).set({ trustedCallbackOutcomeSha256: new Uint8Array(32).fill(9) }).where(and(eq(effects.scopeId, scopeId), eq(effects.effectOrdinal, 1n)));
      expect(await runEffect(Effect.result(journal.run(nextSubject, 1n, { message: "hello" })))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      await db.update(effects).set({ trustedCallbackOutcomeSha256: retained.trustedCallbackOutcomeSha256 }).where(and(eq(effects.scopeId, scopeId), eq(effects.effectOrdinal, 1n)));
      // Control is a genuine distinct subject and requires an explicitly bound
      // callback definition that permits it. Normal and control never alias.
      await runEffect(lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: run.runId,
        decide: current => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: run.runId,
          reason: { code: "requested", message: null } }, current) }));
      const control = await runEffect(issueTrustedWorkflowControlSubject(nextIdentity, subjectOptions));
      expect(await runEffect(Effect.result(journal.run(control, 9n, {})))).toMatchObject({ _tag: "Failure", failure: { reason: "controlForbidden" } });
      const cleanup = await runEffect(makeTrustedWorkflowCallbackJournal({ ...options, definition: { ...definition, allowControl: true } },
        () => Effect.succeed({ kind: "returned" as const, value: null })));
      expect(await runEffect(cleanup.run(control, 9n, {}))).toEqual({ kind: "returned", value: null });
      revokeTrustedWorkflowExecutionSubject(control);
      revokeTrustedWorkflowExecutionSubject(nextSubject);
    });
  }, 180_000);
});

async function withFixture(work: (fixture: { readonly db: FlarexMetadataDatabase; readonly target: LocatedTaskSystemRunAttemptTargetV1;
  readonly transactionTarget: DeadlineOwnedTaskPersistenceTarget }) => Promise<void>) {
  if (driver === "postgres") return withTemporaryPostgresPersistence(async persistence => {
    const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({ connectionString: persistence.pool.options.connectionString,
      options: persistence.pool.options.options, max: 2 }, TASK_LOCATOR, deadlines));
    try { return await work({ db: persistence.drizzle, target: createPostgresLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR), transactionTarget: resource.target }); }
    finally { await resource.close(); }
  });
  const raw = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
  try {
    const persistence = await createPGlitePersistence({ db: raw });
    return await work({ db: persistence.drizzle, target: createPGliteLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR),
      transactionTarget: Result.getOrThrow(createPGliteDeadlineOwnedTaskPersistenceTarget(persistence, TASK_LOCATOR, deadlines)) });
  } finally { await raw.close(); }
}
