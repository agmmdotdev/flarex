import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { inspectTrustedWorkflowTaskBinding, makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1,
  prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decideTrustedWorkflowRegisterContinuation, decideTrustedWorkflowHandleLeaseExpiry, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1,
  decodeTaskDurationMsV1, decodeTaskDatabaseTimeMsV1, type RegisterTrustedWorkflowContinuationCommand,
  type TaskRunIdV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { createPGlitePersistence, createPGliteDeadlineOwnedTaskRunAttemptTarget } from "../../src/database/pglite";
import { fxSystemDurableTaskRunsV1, fxSystemDurableTaskRequestedEffectsV1 } from "../../src/database/schema";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../src/tasks/postgresTaskExternalEffectAuthority";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "../../src/tasks/taskSystemRunAttemptStoreV1";
import { makeTrustedWorkflowCheckpointStore } from "../../src/tasks/trustedWorkflowCheckpoint";
import { fxSystemTrustedWorkflowCheckpoints } from "../../src/tasks/trustedWorkflowCheckpointSchema";
import { makeTrustedWorkflowEventEligibilityStore } from "../../src/tasks/trustedWorkflowEventEligibilityStore";
import { prepareCommitEventEligibility, inspectCommitEventEligibility } from "../../src/commit/events/eligibility";
import { makeTrustedWorkflowContinuationStore } from "../../src/tasks/trustedWorkflowContinuationStore";
import { issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject,
  revokeTrustedWorkflowExecutionSubject, type TrustedWorkflowExecutionSubject } from "../../src/tasks/trustedWorkflowExecutionSubject";
import type { DeadlineOwnedTaskPersistenceTarget } from "../../src/tasks/taskPersistenceTransaction";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";
import { locatedTaskAuthorityV1, readyTaskRunAggregateV1, TASK_LOCATOR } from "./taskSystemRunAttemptStoreTestSupport";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
  statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
let db: FlarexMetadataDatabase;
let target: LocatedTaskSystemRunAttemptTargetV1 & DeadlineOwnedTaskPersistenceTarget;
const cleanups: Array<() => Promise<void>> = [];
let poolState: (() => { total: number; idle: number; waiting: number }) | undefined;

beforeAll(async () => {
  if (driver === "postgres") {
    const fixture = await createFileScopedPostgresFixture(); cleanups.push(fixture.dispose);
    db = fixture.persistence.drizzle;
    const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
      connectionString: fixture.persistence.pool.options.connectionString, options: fixture.persistence.pool.options.options, max: 2,
    }, TASK_LOCATOR, deadlines));
    cleanups.push(resource.close); target = resource.lifecycleTarget;
    poolState = () => ({ total: resource.pool.totalCount, idle: resource.pool.idleCount, waiting: resource.pool.waitingCount });
  } else {
    if (driver !== "pglite") throw new Error("Unknown continuation test driver");
    const raw = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() }); cleanups.push(() => raw.close());
    const persistence = await createPGlitePersistence({ db: raw }); db = persistence.drizzle;
    target = Result.getOrThrow(createPGliteDeadlineOwnedTaskRunAttemptTarget(persistence, TASK_LOCATOR, deadlines));
  }
}, 480_000);
afterAll(async () => { for (const close of cleanups.reverse()) await close(); }, 480_000);

async function scenario(customHash = hash, leaseMs = 45_000) {
  const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: `epoch_${randomUUID()}` });
  const located = await locatedTaskAuthorityV1(db, target, scopeId, `continuation-${randomUUID()}`);
  const canonical = await runEffect(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|operator", subject: "operator", issuer: "issuer" } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  const binding = await runEffect(prepareTrustedWorkflowTaskBinding({ scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: "neutral-one-wait",
    executionPolicy: { continuationSlots: 1 }, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: { ...readyTaskRunAggregateV1().boundPolicy,
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(leaseMs)) } }, hash));
  const options = { authority: located.authority, target, binding, principal,
    principalCanonicalBytes: canonical.canonicalBytes, sha256: customHash };
  const create = makeTrustedWorkflowTaskRunCreationStore(options);
  const created = await runEffect(create.createRun({ requestKey: "one-wait", principal,
    input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x42), 1)) }));
  const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
  const inspect = () => runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
  const grant = async () => {
    const current = await inspect();
    const started = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
        expectedRunVersion: current.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
    if (started.outcome.kind !== "attempt_granted") throw new Error(`Expected genuine grant, got ${started.outcome.kind}`);
    const identity = { runId: created.runId, ...started.outcome.grant.attempt };
    await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: created.runId,
        attemptId: identity.attemptId, executionFence: identity.executionFence,
        heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
    return identity;
  };
  const identity = await grant();
  const subject = await runEffect(issueTrustedWorkflowExecutionSubject(identity, options));
  const checkpointStore = makeTrustedWorkflowCheckpointStore(options);
  const make = () => runEffect(makeTrustedWorkflowContinuationStore(options));
  const continuation = await make();
  const prepare = async (timeout = 3_600_000, expectedRevision = 0n, bytes = new TextEncoder().encode("native checkpoint at waiting")) => {
    const prepared = await runEffect(checkpointStore.prepare({ expectedRevision, codec: "native.test.v1", bytes }));
    const current = await inspect();
    const nativeStartedAtMs = current.observedAtMs;
    const command: RegisterTrustedWorkflowContinuationCommand = { type: "register_continuation", runId: identity.runId, attemptId: identity.attemptId, executionFence: identity.executionFence,
      expectedRunVersion: current.current.runVersion, waitId: "native/import/wait-confirmation-product-import/invoke",
      checkpoint: { revision: expectedRevision + 1n, byteLength: bytes.byteLength, sha256: await runEffect(hash(bytes)) },
      nativeStartedAtMs, timeoutMs: Result.getOrThrow(decodeTaskDurationMsV1(timeout)),
      deadlineAtMs: Result.getOrThrow(decodeTaskDatabaseTimeMsV1(nativeStartedAtMs + timeout)) };
    return { prepared, command };
  };
  return { ...options, lifecycle, created, identity, grant, subject, continuation, make, checkpointStore, prepare, inspect };
}
const checkpoints = async (runId: TaskRunIdV1) => (await db.select().from(fxSystemTrustedWorkflowCheckpoints)
  .where(eq(fxSystemTrustedWorkflowCheckpoints.runId, runId))).map(row => ({ ...row, sha256: new Uint8Array(row.sha256), bytes: new Uint8Array(row.bytes) }));
const requested = (runId: TaskRunIdV1) => db.select().from(fxSystemDurableTaskRequestedEffectsV1)
  .where(eq(fxSystemDurableTaskRequestedEffectsV1.runId, runId)).orderBy(fxSystemDurableTaskRequestedEffectsV1.sequence);

describe(`trusted workflow atomic durable continuation - ${driver}`, () => {
  it("persists the exact checkpoint with suspension, replays after retirement and resumes a fresh charged grant", async () => {
    const s = await scenario(), { prepared, command } = await s.prepare();
    const before = await requested(s.created.runId);
    const accepted = await runEffect(s.continuation.register(s.subject, prepared, command));
    expect(accepted).toMatchObject({ disposition: "accepted", outcome: { kind: "continuation_waiting" } });
    const persisted = await s.inspect();
    expect(persisted.current).toMatchObject({ phase: "continuation_waiting", continuation: { checkpoint: command.checkpoint,
      nativeStartedAtMs: command.nativeStartedAtMs, deadlineAtMs: command.deadlineAtMs } });
    const rows = await db.select().from(fxSystemDurableTaskRunsV1).where(eq(fxSystemDurableTaskRunsV1.runId, s.created.runId));
    expect(rows[0]).toMatchObject({ currentAttemptId: null, currentLeaseExpiresAtMs: null, dueKind: "handle_continuation_timeout",
      dueAtMs: BigInt(command.deadlineAtMs + 1) });
    expect((await checkpoints(s.created.runId))[0]).toMatchObject({ revision: 1n, sha256: command.checkpoint.sha256 });
    const cold = await runEffect(s.continuation.inspect(s.created.runId));
    expect(cold.current).toEqual(persisted.current);
    expect(cold.inputReference).toMatchObject({ byteLength: 1, sha256: new Uint8Array(32).fill(0x42) });
    const stored = Option.getOrThrow(cold.checkpoint);
    expect(stored).toMatchObject({ ...command.checkpoint, codec: "native.test.v1" });
    expect(new TextDecoder().decode(stored.bytes)).toBe("native checkpoint at waiting");
    expect(Object.isFrozen(stored)).toBe(true);
    stored.bytes.fill(0); stored.sha256.fill(0); stored.bindingSha256.fill(0);
    const again = Option.getOrThrow((await runEffect(s.continuation.inspect(s.created.runId))).checkpoint);
    expect(again.sha256).toEqual(command.checkpoint.sha256);
    expect(new TextDecoder().decode(again.bytes)).toBe("native checkpoint at waiting");
    if (poolState !== undefined) { const pool = poolState(); expect(pool.waiting).toBe(0); expect(pool.idle).toBe(pool.total); }
    const fresh = await s.make();
    expect(await runEffect(fresh.register(s.subject, prepared, command))).toEqual({ ...accepted, disposition: "idempotent" });
    expect(await requested(s.created.runId)).toHaveLength(before.length + 2);
    const confirm = { type: "confirm_continuation", runId: s.created.runId, waitId: command.waitId };
    const resolved = await runEffect(fresh.confirm(confirm));
    expect(resolved).toMatchObject({ disposition: "accepted", outcome: { resolution: "confirmed" } });
    const second = await s.grant();
    expect(second.attemptNumber).toBe(2); expect(second.executionFence).toBe(s.identity.executionFence + 1n);
    const nextSubject = await runEffect(issueTrustedWorkflowExecutionSubject(second, s));
    expect(nextSubject).not.toBe(s.subject);
    const finished = await runEffect(s.lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: s.created.runId,
      decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...second,
        completion: { kind: "succeeded", result: null, executionDurationMs: null } }, value) }));
    expect(finished.outcome).toMatchObject({ kind: "terminal_succeeded", terminal: { kind: "succeeded" } });
    expect(await runEffect((await s.make()).confirm(confirm))).toEqual({ ...resolved, disposition: "idempotent" });
    const terminal = await runEffect((await s.make()).inspect(s.created.runId));
    expect(terminal.current).toMatchObject({ phase: "terminal", attemptHistory: { lastAttemptNumber: 2 } });
    expect(Option.getOrThrow(terminal.checkpoint).sha256).toEqual(command.checkpoint.sha256);
    expect((await s.inspect()).current.runVersion).toBe(terminal.current.runVersion);
    revokeTrustedWorkflowExecutionSubject(nextSubject);
  }, 480_000);

  it("serializes late confirmation and eligible timeout with one immutable winning receipt", async () => {
    for (const first of ["confirm", "expire"] as const) {
      const s = await scenario(), { prepared, command } = await s.prepare(1);
      await runEffect(s.continuation.register(s.subject, prepared, command));
      await delay(5);
      const confirm = { type: "confirm_continuation", runId: s.created.runId, waitId: command.waitId };
      const expire = { ...confirm, type: "expire_continuation" };
      const winner = await runEffect(first === "confirm" ? s.continuation.confirm(confirm) : s.continuation.expire(expire));
      expect(winner).toMatchObject({ disposition: "accepted", outcome: { resolution: first === "confirm" ? "confirmed" : "timeout" } });
      const fresh = await s.make();
      expect(await runEffect(first === "confirm" ? fresh.expire(expire) : fresh.confirm(confirm)))
        .toMatchObject({ disposition: "current", outcome: { reason: "already_resolved" } });
      expect(await runEffect(first === "confirm" ? fresh.confirm(confirm) : fresh.expire(expire)))
        .toEqual({ ...winner, disposition: "idempotent" });
      const identity = await s.grant();
      const ordinary = await runEffect(Effect.result(issueTrustedWorkflowExecutionSubject(identity, s)));
      if (first === "expire") {
        expect(ordinary).toMatchObject({ _tag: "Failure", failure: { reason: "notExecuting" } });
        const control = await runEffect(issueTrustedWorkflowControlSubject(identity, s));
        revokeTrustedWorkflowExecutionSubject(control);
      } else expect(Result.isSuccess(ordinary)).toBe(true);
    }
  }, 480_000);

  it("rolls back an actual checkpoint update when the live subject is revoked before suspension", async () => {
    let revoked: TrustedWorkflowExecutionSubject | undefined;
    const oldBytes = new TextEncoder().encode("prior durable native checkpoint");
    const revokeHash = (bytes: Uint8Array) => hash(bytes).pipe(Effect.tap(() => Effect.sync(() => {
      if (revoked !== undefined && Buffer.from(bytes).equals(Buffer.from(oldBytes))) revokeTrustedWorkflowExecutionSubject(revoked);
    })));
    const s = await scenario(revokeHash);
    const previous = await runEffect(s.checkpointStore.prepare({ expectedRevision: 0n, codec: "native.test.v1", bytes: oldBytes }));
    await runEffect(s.checkpointStore.save(s.subject, previous));
    const { prepared, command } = await s.prepare(3_600_000, 1n), before = await s.inspect(), effectsBefore = await requested(s.created.runId);
    revoked = s.subject;
    expect(await runEffect(Effect.result(s.continuation.register(s.subject, prepared, command))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
    expect((await s.inspect()).current).toEqual(before.current);
    expect(await requested(s.created.runId)).toEqual(effectsBefore);
    expect((await checkpoints(s.created.runId))[0]).toMatchObject({ revision: 1n, bytes: oldBytes });
  }, 480_000);

  it("refuses forged subjects, changed descriptors and generic-store registration without writing a checkpoint", async () => {
    const s = await scenario(), { prepared, command } = await s.prepare();
    const before = (await s.inspect()).current;
    // Deliberate forged capability tests runtime identity admission.
    const forged = {} as TrustedWorkflowExecutionSubject;
    expect(await runEffect(Effect.result(s.continuation.register(forged, prepared, command))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
    expect(await runEffect(Effect.result(s.continuation.register(s.subject, prepared,
      { ...command, checkpoint: { ...command.checkpoint, revision: 2n } }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidCheckpoint" } });
    expect(await runEffect(Effect.result(s.lifecycle.transactRunAttempt({ operation: "register_continuation", runId: s.created.runId,
      decide: value => decideTrustedWorkflowRegisterContinuation(command, value) }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupported_integration" } });
    let getterReads = 0;
    const getter = Object.defineProperty({ ...command }, "waitId", { enumerable: true, get() { getterReads++; return command.waitId; } });
    expect(await runEffect(Effect.result(s.continuation.register(s.subject, prepared, getter))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(getterReads).toBe(0); expect(await checkpoints(s.created.runId)).toHaveLength(0);
    expect((await s.inspect()).current).toEqual(before);
  }, 480_000);

  it("keeps cancellation durable until a fresh restricted grant genuinely acknowledges native cancellation", async () => {
    const s = await scenario(), { prepared, command } = await s.prepare();
    await runEffect(s.continuation.register(s.subject, prepared, command));
    const cancellation = { type: "request_cancellation", runId: s.created.runId, reason: { code: "requested", message: null } };
    const accepted = await runEffect(s.continuation.cancel(cancellation));
    expect((await s.inspect()).current).toMatchObject({ phase: "continuation_ready", executionMode: "control", cancellation: { kind: "requested" } });
    const identity = await s.grant();
    const control = await runEffect(issueTrustedWorkflowControlSubject(identity, s));
    expect(await runEffect((await s.make()).cancel(cancellation))).toEqual({ ...accepted, disposition: "idempotent" });
    const active = (await s.inspect()).current;
    if (active.cancellation.kind !== "requested") throw new Error("Expected pending cancellation");
    await runEffect(s.lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: s.created.runId,
      decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity,
        completion: { kind: "cancellation_acknowledged", cancellationGeneration: active.cancellation.generation, executionDurationMs: null } }, value) }));
    expect((await s.inspect()).current).toMatchObject({ phase: "terminal", terminal: { kind: "cancelled", resolution: "acknowledged" } });
    revokeTrustedWorkflowExecutionSubject(control);
    expect(await db.select().from(fxSystemTrustedWorkflowCheckpoints).where(and(
      eq(fxSystemTrustedWorkflowCheckpoints.scopeId, s.authority.scopeId), eq(fxSystemTrustedWorkflowCheckpoints.runId, s.created.runId))))
      .toHaveLength(1);
  }, 480_000);

  it("rejects an alternate lifecycle operation rewriting the original durable wait anchor", async () => {
    const s = await scenario(), { prepared, command } = await s.prepare();
    await runEffect(s.continuation.register(s.subject, prepared, command));
    await runEffect(s.continuation.confirm({ type: "confirm_continuation", runId: s.created.runId, waitId: command.waitId }));
    const identity = await s.grant(), before = await s.inspect();
    const tamper = await runEffect(Effect.result(s.lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: s.created.runId,
      decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: s.created.runId,
        attemptId: identity.attemptId, executionFence: identity.executionFence,
        heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(2)) }, value).pipe(Result.map(decision => {
        if (decision.kind !== "commit" || decision.next.continuation === undefined) throw new Error("Expected genuine heartbeat with continuation");
        const c = decision.next.continuation, evidence = c.registrationReceipt.evidence[0];
        if (evidence?.kind !== "workflow_continuation") throw new Error("Expected original registration evidence");
        const deadlineAtMs = Result.getOrThrow(decodeTaskDatabaseTimeMsV1(c.deadlineAtMs + 1));
        const timeoutMs = Result.getOrThrow(decodeTaskDurationMsV1(c.timeoutMs + 1));
        return { ...decision, next: { ...decision.next, continuation: { ...c, deadlineAtMs, timeoutMs,
          registrationReceipt: { ...c.registrationReceipt, evidence: [{ ...evidence, deadlineAtMs, timeoutMs }] } } } };
      })),
    })));
    expect(tamper).toMatchObject({ _tag: "Failure", failure: { reason: "next_state_invalid" } });
    expect((await s.inspect()).current).toEqual(before.current);
    expect((await checkpoints(s.created.runId))[0]).toMatchObject({ revision: command.checkpoint.revision, sha256: command.checkpoint.sha256 });
  }, 480_000);
  it("binds event roles to the actual Task run, reopens identical gates and admits genuine control decisions", async () => {
    const s = await scenario();
    const roles = [{ role: "workflow", policyRevision: "c".repeat(64), maximumCommits: 16, maximumOccurrences: 1 },
      { role: "notification", policyRevision: "d".repeat(64), maximumCommits: 2, maximumOccurrences: 2 }];
    const make = () => runEffect(makeTrustedWorkflowEventEligibilityStore({ ...s, roles }));
    const gates = await make(), parent = { role: "workflow", occurrence: 1 }, notification = { role: "notification", occurrence: 1 };
    const parentGate = await runEffect(gates.open(s.subject, parent)), notificationGate = await runEffect(gates.open(s.subject, notification));
    const references = Result.getOrThrow(inspectCommitEventEligibility(Result.getOrThrow(prepareCommitEventEligibility([parentGate, notificationGate]))));
    expect(references).toHaveLength(2);
    const fresh = await make(), reopened = await runEffect(fresh.open(s.subject, parent));
    const reopenedRefs = Result.getOrThrow(inspectCommitEventEligibility(Result.getOrThrow(prepareCommitEventEligibility([reopened]))));
    expect(references).toContainEqual(reopenedRefs[0]);
    expect(await runEffect(fresh.inspect(s.subject, parent))).toMatchObject({ state: "held", memberCount: 0 });
    expect(await runEffect(Effect.result(fresh.open(s.subject, { role: "workflow", occurrence: 2 }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    await runEffect(s.continuation.cancel({ type: "request_cancellation", runId: s.created.runId,
      reason: { code: "requested", message: null } }));
    expect(await runEffect(Effect.result(fresh.decide(s.subject, parent, "released"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "notExecuting" } });
    const control = await runEffect(issueTrustedWorkflowControlSubject(s.identity, s));
    expect(await runEffect(fresh.decide(control, notification, "released"))).toBe("applied");
    expect(await runEffect((await make()).decide(control, notification, "released"))).toBe("replayed");
    expect(await runEffect(fresh.decide(control, parent, "cleared"))).toBe("applied");
    expect(await runEffect(fresh.inspect(control, parent))).toMatchObject({ state: "cleared" });
    expect(await runEffect(Effect.result(fresh.decide(control, parent, "released"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "groupConflict" } });
    revokeTrustedWorkflowExecutionSubject(control);
    expect(await runEffect(Effect.result(fresh.decide(control, notification, "released"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
  }, 480_000);

  it("fails pre-slot cancellation honestly when the actual active lease expires before native acknowledgement", async () => {
    const s = await scenario(hash, 1000);
    await runEffect(s.continuation.cancel({ type: "request_cancellation", runId: s.created.runId,
      reason: { code: "requested", message: null } }));
    const active = (await s.inspect()).current;
    if (active.phase !== "executing") throw new Error("Expected genuine active cancellation");
    expect(active.continuation).toBeUndefined();
    await delay(Math.max(0, active.currentAttempt.lease.expiresAtMs - Date.now()) + 5);
    const expired = await runEffect(s.lifecycle.transactRunAttempt({ operation: "handle_lease_expiry", runId: s.created.runId,
      decide: value => decideTrustedWorkflowHandleLeaseExpiry({ type: "handle_lease_expiry", runId: s.created.runId,
        attemptId: active.currentAttempt.attemptId, executionFence: active.currentAttempt.executionFence,
        expectedLeaseVersion: active.currentAttempt.lease.version }, value) }));
    expect(expired.outcome).toMatchObject({ kind: "terminal_failed", terminal: { kind: "failed", failure: { code: "execution_lost" } } });
    const failed = (await s.inspect()).current;
    expect(failed).toMatchObject({ phase: "terminal", cancellation: { kind: "resolved", resolution: "superseded_by_completion" } });
    if (failed.phase !== "terminal" || failed.terminal.kind !== "failed") throw new Error("Expected unresolved native cancellation failure");
    expect(failed.terminal.failure.message).toContain("Native workflow control did not complete");
  }, 480_000);

  it("refuses another principal's cold checkpoint read and verifies stored bytes before exposing them", async () => {
    const s = await scenario();
    expect((await runEffect(s.continuation.inspect(s.created.runId))).checkpoint).toEqual(Option.none());
    const { prepared, command } = await s.prepare();
    await runEffect(s.continuation.register(s.subject, prepared, command));
    const otherCanonical = await runEffect(canonicalizeFlarexValueV1Effect({ version: 1, scopeId: s.authority.scopeId,
      executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|other", subject: "other", issuer: "issuer" } } }));
    const otherPrincipal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(otherCanonical.sha256, otherCanonical.canonicalBytes.byteLength));
    const otherOptions = { ...s, principal: otherPrincipal, principalCanonicalBytes: otherCanonical.canonicalBytes };
    expect(await runEffect(Effect.result(makeTrustedWorkflowContinuationStore(otherOptions))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidBinding" } });
    const ownDefinition = Result.getOrThrow(inspectTrustedWorkflowTaskBinding(s.binding)).definition;
    const otherBinding = await runEffect(prepareTrustedWorkflowTaskBinding({ ...ownDefinition,
      principalSha256: encodeBytesToLowercaseHex(otherPrincipal.sha256) }, hash));
    const other = await runEffect(makeTrustedWorkflowContinuationStore({ ...otherOptions, binding: otherBinding }));
    expect(await runEffect(Effect.result(other.inspect(s.created.runId))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidBinding" } });
    const original = (await checkpoints(s.created.runId))[0];
    if (original === undefined) throw new Error("Expected the actual waiting checkpoint");
    const corrupted = original.bytes.slice(); corrupted[0] = (corrupted[0] ?? 0) ^ 1;
    // Deliberate storage corruption keeps SQL shape/length valid while breaking
    // the authoritative digest. No native parser participates in this proof.
    await db.update(fxSystemTrustedWorkflowCheckpoints).set({ bytes: corrupted })
      .where(eq(fxSystemTrustedWorkflowCheckpoints.runId, s.created.runId));
    try {
      expect(await runEffect(Effect.result(s.continuation.inspect(s.created.runId))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    } finally {
      await db.update(fxSystemTrustedWorkflowCheckpoints).set({ bytes: original.bytes })
        .where(eq(fxSystemTrustedWorkflowCheckpoints.runId, s.created.runId));
    }
    const restored = await runEffect((await s.make()).inspect(s.created.runId));
    expect(Option.getOrThrow(restored.checkpoint).bytes).toEqual(original.bytes);
    expect(restored.current).toMatchObject({ phase: "continuation_waiting", attemptHistory: { lastAttemptNumber: 1 } });
  }, 480_000);

  it("correlates cold checkpoint revisions and commitments with the immutable wait anchor until a genuine resume", async () => {
    const s = await scenario();
    const prior = await runEffect(s.checkpointStore.prepare({ expectedRevision: 0n, codec: "native.test.v1",
      bytes: new TextEncoder().encode("prior native checkpoint") }));
    await runEffect(s.checkpointStore.save(s.subject, prior));
    const { prepared, command } = await s.prepare(3_600_000, 1n);
    await runEffect(s.continuation.register(s.subject, prepared, command));
    const original = (await checkpoints(s.created.runId))[0];
    if (original === undefined) throw new Error("Expected anchored checkpoint revision2");
    await db.delete(fxSystemTrustedWorkflowCheckpoints).where(eq(fxSystemTrustedWorkflowCheckpoints.runId, s.created.runId));
    try {
      expect(await runEffect(Effect.result(s.continuation.inspect(s.created.runId))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    } finally { await db.insert(fxSystemTrustedWorkflowCheckpoints).values(original); }
    const changedBytes = original.bytes.slice(); changedBytes[0] = (changedBytes[0] ?? 0) ^ 1;
    const longerBytes = new Uint8Array(original.bytes.length + 1); longerBytes.set(original.bytes);
    for (const changed of [
      { revision: original.revision - 1n },
      { revision: original.revision + 1n },
      { bytes: changedBytes, sha256: await runEffect(hash(changedBytes)) },
      { bytes: longerBytes, byteLength: longerBytes.byteLength, sha256: await runEffect(hash(longerBytes)) },
    ]) {
      await db.update(fxSystemTrustedWorkflowCheckpoints).set(changed).where(eq(fxSystemTrustedWorkflowCheckpoints.runId, s.created.runId));
      try {
        expect(await runEffect(Effect.result(s.continuation.inspect(s.created.runId))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      } finally {
        await db.update(fxSystemTrustedWorkflowCheckpoints).set(original).where(eq(fxSystemTrustedWorkflowCheckpoints.runId, s.created.runId));
      }
    }
    await runEffect(s.continuation.confirm({ type: "confirm_continuation", runId: s.created.runId, waitId: command.waitId }));
    const resumed = await s.grant();
    const subject = await runEffect(issueTrustedWorkflowExecutionSubject(resumed, s));
    const advanced = await runEffect(s.checkpointStore.prepare({ expectedRevision: original.revision,
      codec: "native.test.v1", bytes: new TextEncoder().encode("genuine native checkpoint after resume") }));
    await runEffect(s.checkpointStore.save(subject, advanced));
    const inspected = await runEffect((await s.make()).inspect(s.created.runId));
    expect(Option.getOrThrow(inspected.checkpoint).revision).toBe(original.revision + 1n);
    expect(inspected.current).toMatchObject({ phase: "executing", continuation: { checkpoint: { revision: original.revision } } });
    revokeTrustedWorkflowExecutionSubject(subject);
  }, 480_000);

});
