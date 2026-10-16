import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { inspectTrustedWorkflowTaskBinding, makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1,
  prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt,
  decideTrustedWorkflowRequestCancellation, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1,
  decodeTaskDurationMsV1, decodeTrustedWorkflowTaskRunAttemptAggregateJson,
  encodeTrustedWorkflowTaskRunAttemptAggregateJson } from "@flarex/durable-task/internal/run-attempt-v1";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../src/tasks/trustedWorkflowTaskRunCreation";
import { issueTrustedWorkflowExecutionSubject, inspectTrustedWorkflowExecutionSubject,
  requireLiveTrustedWorkflowExecutionSubject, revokeTrustedWorkflowExecutionSubject } from "../../src/tasks/trustedWorkflowExecutionSubject";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "../../src/tasks/taskSystemRunAttemptStoreV1";
import { fxSystemDurableTaskRunsV1, fxSystemTrustedWorkflowTaskBindings } from "../../src/database/schema";
import { createPGlitePersistence, createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGliteDeadlineOwnedTaskPersistenceTarget } from "../../src/database/pglite";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from "../../src/database/postgres";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../src/tasks/postgresTaskExternalEffectAuthority";
import { requireDeadlineOwnedTaskPersistenceTarget, type DeadlineOwnedTaskPersistenceTarget } from "../../src/tasks/taskPersistenceTransaction";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { runLocatedEffectTransaction } from "../../src/database/locatedEffectTransaction";
import { requireLockedTaskSystemScopeAuthorityV1 } from "../../src/tasks/taskSystemScopeAuthorityV1";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { withTemporaryPostgresPersistence } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";
import { locatedTaskAuthorityV1, readyTaskRunAggregateV1, TASK_LOCATOR } from "./taskSystemRunAttemptStoreTestSupport";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
  statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
describe(`trusted workflow execution subject - ${driver}`, () => {
  it("refuses structural handles without observing their getters", () => {
    let reads = 0;
    const forged = { get runId() { reads += 1; throw new Error("Must not inspect shape"); } };
    expect(inspectTrustedWorkflowExecutionSubject(forged)).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
    expect(reads).toBe(0);
    expect(inspectTrustedWorkflowExecutionSubject(null)).toMatchObject({ _tag: "Failure" });
  });

  it("authenticates canonical binding, policy, principal, current attempt, cancellation and lease in actual transactions", async () => {
    await withFixture(async ({ db, target, transactionTarget }) => {
      const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
      await insertCurrentScopeClockFixture(db, { scopeId, epoch: `epoch_${randomUUID()}` });
      const located = await locatedTaskAuthorityV1(db, target, scopeId, "workflow-subject-fixture");
      const principalValue = await runEffect(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
        executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|user", subject: "user", issuer: "issuer", roles: ["operator"] } } }));
      const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(principalValue.sha256, principalValue.canonicalBytes.byteLength));
      const binding = await runEffect(prepareTrustedWorkflowTaskBinding({ scopeId, workflowRevision: "a".repeat(64),
        adapterRevision: "b".repeat(64), executionProfile: "neutral-child", executionPolicy: { commands: ["one-child"] },
        principalSha256: encodeBytesToLowercaseHex(principal.sha256), boundPolicy: {
          ...readyTaskRunAggregateV1().boundPolicy, leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(2_000)),
        } }, hash));
      const bindingState = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(binding));
      const store = makeTrustedWorkflowTaskRunCreationStore({ authority: located.authority, target: transactionTarget, binding, sha256: hash });
      const created = await runEffect(store.createRun({ requestKey: "subject", principal,
        input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x22), 1)) }));
      const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
      const initial = await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
      const started = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
        decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
          expectedRunVersion: initial.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
      if (started.outcome.kind !== "attempt_granted") throw new Error("Expected genuine attempt grant");
      const identity = { runId: created.runId, ...started.outcome.grant.attempt };
      const options = { authority: located.authority, target: transactionTarget, binding, principal,
        principalCanonicalBytes: principalValue.canonicalBytes, sha256: hash };
      expect(requireDeadlineOwnedTaskPersistenceTarget(target)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
      // Deliberately forged compile-time capability exercises the runtime refusal.
      const unbounded = target as unknown as DeadlineOwnedTaskPersistenceTarget;
      expect(await runEffect(Effect.result(issueTrustedWorkflowExecutionSubject(identity, { ...options, target: unbounded }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
      expect(await runEffect(Effect.result(makeTrustedWorkflowTaskRunCreationStore({
        authority: located.authority, target: unbounded, binding, sha256: hash,
      }).createRun({ requestKey: "unbounded-refused", principal,
        input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(3), 1)) }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
      const issue = (value: unknown = identity) => issueTrustedWorkflowExecutionSubject(value, options);
      const refusedGrant = await runEffect(Effect.result(issue()));
      expect(refusedGrant).toMatchObject({ _tag: "Failure", failure: { reason: "notExecuting" } });
      await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
        decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: created.runId,
          attemptId: identity.attemptId, executionFence: identity.executionFence,
          heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
      let reads = 0;
      const getterInput = Object.defineProperty({ ...identity }, "runId", { enumerable: true, get() { reads += 1; return created.runId; } });
      expect(await runEffect(Effect.result(issue(getterInput)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(reads).toBe(0);
      expect(await runEffect(Effect.result(issue({ ...identity, executionFence: identity.executionFence + 1n }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "staleAttempt" } });
      const badBytes = principalValue.canonicalBytes.slice(); badBytes[0] = 0;
      expect(await runEffect(Effect.result(issueTrustedWorkflowExecutionSubject(identity, { ...options, principalCanonicalBytes: badBytes }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      const subject = await runEffect(issue());
      const inspected = Result.getOrThrow(inspectTrustedWorkflowExecutionSubject(subject));
      expect(inspected.executionPrincipal.executionIdentity.user.subject).toBe("user");
      expect(Object.isFrozen(inspected.executionPrincipal.executionIdentity.user.roles)).toBe(true);
      inspected.bindingSha256.fill(0); inspected.principal.sha256.fill(0);
      const borrowed = () => runLocatedEffectTransaction(target, "subject-test", tx => Effect.gen(function* () {
        yield* Effect.promise(() => requireLockedTaskSystemScopeAuthorityV1(tx, located.authority, target, reason => new Error(reason)));
        return yield* requireLiveTrustedWorkflowExecutionSubject(tx, subject, located.authority);
      }), (_operation, cause) => cause, "Subject test rolled back");
      const pins = await runEffect(borrowed());
      expect(pins.remainingLeaseMs).toBeGreaterThan(0); expect(pins.remainingLeaseMs).toBeLessThanOrEqual(2_000);
      expect(pins.bindingSha256).toEqual(bindingState.sha256);
      // A stored canonical-byte alteration never gains authority through an unchanged digest.
      const badBinding = bindingState.canonicalBytes.slice(); badBinding[0] = 0;
      await db.update(fxSystemTrustedWorkflowTaskBindings).set({ canonicalBytes: badBinding }).where(eq(fxSystemTrustedWorkflowTaskBindings.scopeId, scopeId));
      expect(await runEffect(Effect.result(borrowed()))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      await db.update(fxSystemTrustedWorkflowTaskBindings).set({ canonicalBytes: bindingState.canonicalBytes }).where(eq(fxSystemTrustedWorkflowTaskBindings.scopeId, scopeId));
      const rows = await db.select().from(fxSystemDurableTaskRunsV1).where(eq(fxSystemDurableTaskRunsV1.runId, created.runId));
      const original = rows[0]; if (original === undefined) throw new Error("Missing run");
      const changedPrincipal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(new Uint8Array(32).fill(9), 1));
      await db.update(fxSystemDurableTaskRunsV1).set({ executionPrincipalSha256: changedPrincipal.sha256,
        executionPrincipalObjectKey: changedPrincipal.objectKey }).where(eq(fxSystemDurableTaskRunsV1.runId, created.runId));
      expect(await runEffect(Effect.result(borrowed()))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      await db.update(fxSystemDurableTaskRunsV1).set({ executionPrincipalSha256: original.executionPrincipalSha256,
        executionPrincipalObjectKey: original.executionPrincipalObjectKey }).where(eq(fxSystemDurableTaskRunsV1.runId, created.runId));
      const originalAggregate = Result.getOrThrow(decodeTrustedWorkflowTaskRunAttemptAggregateJson(original.aggregateJson));
      const changedPolicy = Result.getOrThrow(encodeTrustedWorkflowTaskRunAttemptAggregateJson({ ...originalAggregate,
        boundPolicy: { ...originalAggregate.boundPolicy, maximumDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(300_001)) } }));
      await db.update(fxSystemDurableTaskRunsV1).set({ aggregateJson: changedPolicy,
        aggregateByteLength: BigInt(new TextEncoder().encode(JSON.stringify(changedPolicy)).byteLength) }).where(eq(fxSystemDurableTaskRunsV1.runId, created.runId));
      expect(await runEffect(Effect.result(borrowed()))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      await db.update(fxSystemDurableTaskRunsV1).set({ aggregateJson: original.aggregateJson,
        aggregateByteLength: original.aggregateByteLength }).where(eq(fxSystemDurableTaskRunsV1.runId, created.runId));
      // PostgreSQL wall time advances while this process holds no Task resources.
      await new Promise(resolve => setTimeout(resolve, 2_050));
      expect(await runEffect(Effect.result(borrowed()))).toMatchObject({ _tag: "Failure", failure: { reason: "leaseExpired" } });
      revokeTrustedWorkflowExecutionSubject(subject);
      expect(inspectTrustedWorkflowExecutionSubject(subject)).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
      expect(await runEffect(Effect.result(borrowed()))).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
      await runEffect(lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: created.runId,
        decide: value => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: created.runId,
          reason: { code: "requested", message: null } }, value) }));
      expect(await runEffect(Effect.result(issue()))).toMatchObject({ _tag: "Failure", failure: { reason: "notExecuting" } });
    });
  }, 480_000);

  it.runIf(driver === "postgres")("bounds blocked run locks and saturated acquisition, drains after requested cancellation and reuses the actual owned pool", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
      await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId, epoch: `epoch_${randomUUID()}` });
      const target = createPostgresLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR);
      const located = await locatedTaskAuthorityV1(persistence.drizzle, target, scopeId, "bounded-workflow-subject");
      const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
        connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 1,
      }, TASK_LOCATOR, { connectionTimeoutMilliseconds: 200, lockTimeoutMilliseconds: 150,
        statementTimeoutMilliseconds: 500, transactionTimeoutMilliseconds: 1000, settlementReserveMilliseconds: 1500 }));
      try {
        const flags = await resource.pool.query<{ forbidden: boolean }>(`select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls as forbidden
          from pg_roles where rolname = current_user`);
        expect(flags.rows[0]?.forbidden).toBe(false);
        const canonical = await runEffect(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
          executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|user", subject: "user", issuer: "issuer" } } }));
        const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
        const binding = await runEffect(prepareTrustedWorkflowTaskBinding({ scopeId, workflowRevision: "a".repeat(64),
          adapterRevision: "b".repeat(64), executionProfile: "bounded-neutral-child", executionPolicy: {},
          principalSha256: encodeBytesToLowercaseHex(principal.sha256), boundPolicy: readyTaskRunAggregateV1().boundPolicy }, hash));
        const create = makeTrustedWorkflowTaskRunCreationStore({ authority: located.authority, target: resource.target, binding, sha256: hash });
        const request = { principal, input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(4), 1)) };
        const created = await runEffect(create.createRun({ ...request, requestKey: "bounded" }));
        const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
        const current = await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
        const started = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
          decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
            expectedRunVersion: current.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
        if (started.outcome.kind !== "attempt_granted") throw new Error("Expected genuine attempt grant");
        const identity = { runId: created.runId, ...started.outcome.grant.attempt };
        await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
          decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: created.runId,
            attemptId: identity.attemptId, executionFence: identity.executionFence,
            heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
        const issue = () => issueTrustedWorkflowExecutionSubject(identity, { authority: located.authority,
          target: resource.target, binding, principal, principalCanonicalBytes: canonical.canonicalBytes, sha256: hash });
        const blocker = await persistence.pool.connect();
        try {
          await blocker.query("begin");
          await blocker.query("select 1 from fx_system_durable_task_run_v1 where scope_id = $1 and run_id = $2 for update", [scopeId, created.runId]);
          const begin = performance.now();
          const blocked = await runEffect(Effect.result(issue()));
          expect(performance.now() - begin).toBeLessThan(1500);
          expect(blocked).toMatchObject({ _tag: "Failure", failure: { reason: "storeFailure" } });
          if (Result.isFailure(blocked)) expect(postgresCode(blocked.failure)).toBe("55P03");
          expect(resource.pool.waitingCount).toBe(0); expect(resource.pool.idleCount).toBe(1);
        } finally { await blocker.query("rollback"); blocker.release(); }
        const subject = await runEffect(issue()); revokeTrustedWorkflowExecutionSubject(subject);

        const held = await resource.pool.connect();
        try {
          const saturated: readonly Effect.Effect<void, Effect.Error<ReturnType<typeof issue> | ReturnType<typeof create.createRun>>>[] =
            [issue().pipe(Effect.asVoid), create.createRun({ ...request, requestKey: "saturated-refused" }).pipe(Effect.asVoid)];
          for (const work of saturated) {
            const begin = performance.now();
            expect(await runEffect(Effect.result(work))).toMatchObject({ _tag: "Failure", failure: { reason: "storeFailure" } });
            expect(performance.now() - begin).toBeLessThan(1500);
            expect(resource.pool.waitingCount).toBe(0); expect(resource.pool.totalCount).toBe(1);
          }
          const fiber = Effect.runFork(issue());
          try {
            await waitUntil(() => resource.pool.waitingCount === 1);
            const begin = performance.now();
            const interrupted = runEffect(Fiber.interrupt(fiber));
            await delay(10);
            expect(resource.pool.waitingCount).toBe(1);
            await interrupted;
            const exit = await runEffect(Fiber.await(fiber));
            // rc.112 preserves a masked foreign deadline failure when a pending
            // interruption competes with it. The owner drains; it does not claim
            // to abort pool acquisition or replace this complete failure Cause.
            if (Exit.isSuccess(exit)) throw new Error("Pending cancellation unexpectedly minted a subject");
            expect(Cause.hasInterrupts(exit.cause)).toBe(false);
            expect(exit.cause.reasons).toHaveLength(1);
            expect(Cause.findErrorOption(exit.cause)).toMatchObject({ _tag: "Some", value: {
              _tag: "TrustedWorkflowExecutionSubjectError", reason: "storeFailure",
              cause: { _tag: "TaskPersistenceTransactionError", reason: "storeFailure" },
            } });
            expect(performance.now() - begin).toBeLessThan(1500);
            expect(resource.pool.waitingCount).toBe(0); expect(resource.pool.idleCount).toBe(0);
          } finally { await runEffect(Fiber.interrupt(fiber)); }
        } finally { held.release(); }
        const again = await runEffect(issue()); revokeTrustedWorkflowExecutionSubject(again);
        expect((await runEffect(create.createRun({ ...request, requestKey: "after-drain" }))).status).toBe("created");
        expect(resource.pool.waitingCount).toBe(0); expect(resource.pool.totalCount).toBe(1); expect(resource.pool.idleCount).toBe(1);
        expect((await persistence.drizzle.select().from(fxSystemDurableTaskRunsV1).where(eq(fxSystemDurableTaskRunsV1.scopeId, scopeId)))).toHaveLength(2);
      } finally { await resource.close(); }
    });
  }, 480_000);
});

async function waitUntil(predicate: () => boolean) {
  const deadline = performance.now() + 1000;
  while (!predicate()) { if (performance.now() >= deadline) throw new Error("Expected actual queued pool acquisition"); await delay(5); }
}
function postgresCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const code = Object.getOwnPropertyDescriptor(current, "code");
    if (code !== undefined && "value" in code && typeof code.value === "string") return code.value;
    const cause = Object.getOwnPropertyDescriptor(current, "cause");
    current = cause !== undefined && "value" in cause ? cause.value : undefined;
  }
  return undefined;
}

async function withFixture(run: (fixture: { readonly db: FlarexMetadataDatabase; readonly target: LocatedTaskSystemRunAttemptTargetV1;
  readonly transactionTarget: DeadlineOwnedTaskPersistenceTarget }) => Promise<void>) {
  if (driver === "postgres") return withTemporaryPostgresPersistence(async persistence => {
    const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
      connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 2,
    }, TASK_LOCATOR, deadlines));
    try { return await run({ db: persistence.drizzle, target: createPostgresLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR),
      transactionTarget: resource.target }); } finally { await resource.close(); }
  });
  const raw = newTestPGlite();
  try {
    const persistence = await createPGlitePersistence({ db: raw }); await persistence.migrate();
    return await run({ db: persistence.drizzle, target: createPGliteLocatedTaskSystemRunAttemptTargetV1(persistence, TASK_LOCATOR),
      transactionTarget: Result.getOrThrow(createPGliteDeadlineOwnedTaskPersistenceTarget(persistence, TASK_LOCATOR, deadlines)) });
  } finally { await raw.close(); }
}
