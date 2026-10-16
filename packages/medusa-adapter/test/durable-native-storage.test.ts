import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decodeTaskRetryJitterV1,
  decodeTaskHeartbeatSequenceV1, MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES } from "@flarex/durable-task/internal/run-attempt-v1";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { createStep, createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk/durable";
import { TransactionCheckpoint, SkipStepAlreadyFinishedError } from "@medusajs/orchestration/transaction";
import type { FlarexMetadataDatabase } from "../../persistence-postgres/src/application/deployments";
import { createPGlitePersistence, createPGliteDeadlineOwnedTaskRunAttemptTarget } from "../../persistence-postgres/src/database/pglite";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../persistence-postgres/src/tasks/postgresTaskExternalEffectAuthority";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../persistence-postgres/src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "../../persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1";
import { makeTrustedWorkflowCheckpointStore, inspectPreparedTrustedWorkflowCheckpoint } from "../../persistence-postgres/src/tasks/trustedWorkflowCheckpoint";
import { issueTrustedWorkflowExecutionSubject, inspectTrustedWorkflowInterpreterSubject, revokeTrustedWorkflowExecutionSubject } from "../../persistence-postgres/src/tasks/trustedWorkflowExecutionSubject";
import type { DeadlineOwnedTaskPersistenceTarget } from "../../persistence-postgres/src/tasks/taskPersistenceTransaction";
import { insertCurrentScopeClockFixture } from "../../persistence-postgres/test/scope/scopeClockFixture";
import { newTestPGlite } from "../../persistence-postgres/test/support/pgliteSearchExtensions";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/support/postgresHelpers";
import { locatedTaskAuthorityV1, readyTaskRunAggregateV1, TASK_LOCATOR } from "../../persistence-postgres/test/tasks/taskSystemRunAttemptStoreTestSupport";
import { makeDurableNativeStorage, isDurableNativeBoundaryFailure, nativeCheckpointCodec } from "../src/workflow/durable-native-storage";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
const cleanup: Array<() => Promise<void>> = [];
const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
  statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
let db: FlarexMetadataDatabase;
let target: LocatedTaskSystemRunAttemptTargetV1 & DeadlineOwnedTaskPersistenceTarget;
const workflowId = "native-checkpoint-protocol-proof";
const waitId = "native-checkpoint-protocol-wait";
const wait = createStep({ name: waitId, async: true, timeout: 60 }, async () => {});
const workflow = createWorkflow(workflowId, (input: { id: string }) => { wait(); return new WorkflowResponse(input); });

beforeAll(async () => {
  if (driver === "postgres") {
    const fixture = await createFileScopedPostgresFixture(); cleanup.push(fixture.dispose); db = fixture.persistence.drizzle;
    const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
      connectionString: fixture.persistence.pool.options.connectionString, options: fixture.persistence.pool.options.options, max: 2,
    }, TASK_LOCATOR, deadlines));
    cleanup.push(resource.close); target = resource.lifecycleTarget;
  } else {
    if (driver !== "pglite") throw new Error("Unsupported native checkpoint test driver");
    const raw = newTestPGlite(); cleanup.push(() => raw.close());
    const persistence = await createPGlitePersistence({ db: raw }); await persistence.migrate(); db = persistence.drizzle;
    target = Result.getOrThrow(createPGliteDeadlineOwnedTaskRunAttemptTarget(persistence, TASK_LOCATOR, deadlines));
  }
}, 480_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 480_000);

/** Uses genuine Task creation, grants, heartbeat and subject issuance. There is
 * no handwritten Task/CAS model and no structurally fabricated capability. */
async function scenario() {
  const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: `epoch_${randomUUID()}` });
  const located = await locatedTaskAuthorityV1(db, target, scopeId, `native-storage-${randomUUID()}`);
  const canonical = await Effect.runPromise(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|native", subject: "native", issuer: "issuer" } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  const binding = await Effect.runPromise(prepareTrustedWorkflowTaskBinding({ scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: "native-checkpoint-test",
    executionPolicy: { nativeWaits: 1 }, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: readyTaskRunAggregateV1().boundPolicy }, hash));
  const options = { authority: located.authority, target, binding, principal, principalCanonicalBytes: canonical.canonicalBytes, sha256: hash };
  const created = await Effect.runPromise(makeTrustedWorkflowTaskRunCreationStore(options).createRun({ requestKey: "native",
    principal, input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x42), 1)) }));
  const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
  const current = await Effect.runPromise(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
  const started = await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
    decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
      expectedRunVersion: current.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
  if (started.outcome.kind !== "attempt_granted") throw new Error("Missing actual native Task grant");
  const identity = { runId: created.runId, ...started.outcome.grant.attempt };
  await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
    decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...identity,
      heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
  const subject = await Effect.runPromise(issueTrustedWorkflowExecutionSubject(identity, options));
  cleanup.push(async () => { revokeTrustedWorkflowExecutionSubject(subject); });
  const checkpointStore = makeTrustedWorkflowCheckpointStore(options);
  const base = { subject, checkpointStore, runEffect: Effect.runPromise, workflowId, transactionId: created.runId,
    uncheckpointedChild: { workflowId: "native-finite-child", transactionId: `native-finite-child-as-step-${created.runId}` },
    waitStepId: waitId, timeoutMs: 60_000, expectedInput: { id: "native-input" }, clock: { now: () => 1_000_000 } };
  const bridge = await Effect.runPromise(makeDurableNativeStorage(base));
  const runNative = () => workflow().run({ input: base.expectedInput, runtime: bridge.runtime,
    context: { transactionId: created.runId, preventReleaseEvents: true } });
  return { subject, checkpointStore, base, bridge, runNative };
}

describe(`native checkpoint bridge - ${driver}`, { concurrent: false }, () => {
  it.each(["confirmation-step", "future-child-attempt"] as const)("refuses recovery outside the fixed child and authentic Task budget: %s", async violation => {
    const s = await scenario();
    const executed = await s.runNative();
    await Effect.runPromise(s.bridge.drain);
    const bridge = await Effect.runPromise(makeDurableNativeStorage({ ...s.base, recoveryStepId: "batch-products-as-step" }));
    if (violation === "future-child-attempt") {
      await expect(bridge.runtime.storage.get(`dtrx:${s.base.uncheckpointedChild.workflowId}:${s.base.uncheckpointedChild.transactionId}-attempt-2`))
        .rejects.toSatisfy(isDurableNativeBoundaryFailure);
    } else {
      const actualWait = Object.values(executed.transaction.getFlow().steps).find(step => step.definition?.action === waitId);
      if (actualWait === undefined) throw new Error("Missing actual native wait step");
      await expect(bridge.runtime.storage.scheduleRetry(executed.transaction, actualWait, s.base.clock.now(), 0))
        .rejects.toSatisfy(isDurableNativeBoundaryFailure);
    }
    const exit = await Effect.runPromiseExit(bridge.assertHealthy);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ reason: "unsupportedProfile" });
    expect(inspectTrustedWorkflowInterpreterSubject(s.subject)).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
  }, 480_000);

  it("persists genuine native JSON and recovers its original wait without scheduling again", async () => {
    const s = await scenario();
    await s.runNative(); await Effect.runPromise(s.bridge.drain); await Effect.runPromise(s.bridge.assertHealthy);
    const proposal = await Effect.runPromise(s.bridge.waitProposal);
    expect(proposal).toEqual({ waitId, nativeStartedAtMs: 1_000_000, timeoutMs: 60_000, deadlineAtMs: 1_060_000 });
    const latest = await Effect.runPromise(s.bridge.latest);
    if (latest === undefined) throw new Error("No actual native checkpoint");
    const descriptor = Result.getOrThrow(inspectPreparedTrustedWorkflowCheckpoint(latest.prepared));
    expect(descriptor.expectedRevision + 1n).toBe(latest.revision);
    const cold = await Effect.runPromise(makeDurableNativeStorage({ ...s.base, clock: { now: () => 2_000_000 } }));
    const checkpoint = await Effect.runPromise(cold.checkpoint);
    expect(checkpoint).toBeInstanceOf(TransactionCheckpoint);
    expect(await Effect.runPromise(cold.waitProposal)).toEqual(proposal);
    const recovered = await Effect.runPromise(cold.latest);
    if (recovered === undefined) throw new Error("No recovered prepared capability");
    expect(Result.getOrThrow(inspectPreparedTrustedWorkflowCheckpoint(recovered.prepared))).toEqual(descriptor);
    expect(await Promise.resolve(workflow().resolveResult(new (await import("@medusajs/orchestration/transaction")).DistributedTransaction(
      checkpoint!.flow, async () => {}, undefined, checkpoint!.errors, checkpoint!.context, cold.runtime,
    )))).toEqual({ id: "native-input" });
  }, 480_000);

  it("serializes concurrent native saves through the existing core CAS", async () => {
    const s = await scenario(); await s.runNative(); await Effect.runPromise(s.bridge.drain);
    const checkpoint = await Effect.runPromise(s.bridge.checkpoint);
    if (checkpoint === undefined) throw new Error("No actual checkpoint");
    let active = 0, maximum = 0;
    const save = s.checkpointStore.save;
    const store = { ...s.checkpointStore, save: (...args: Parameters<typeof save>) => Effect.gen(function* () {
      active++; maximum = Math.max(maximum, active);
      return yield* save(...args).pipe(Effect.ensuring(Effect.sync(() => { active--; })));
    }) };
    const bridge = await Effect.runPromise(makeDurableNativeStorage({ ...s.base, checkpointStore: store }));
    await Promise.all([bridge.runtime.storage.save(`dtrx:${workflowId}:${s.base.transactionId}`, checkpoint),
      bridge.runtime.storage.save(`dtrx:${workflowId}:${s.base.transactionId}`, checkpoint)]);
    expect(maximum).toBe(1);
    await Effect.runPromise(bridge.assertHealthy);
  }, 480_000);

  it("retains the first full Cause and revokes the subject when native checkpoint code catches the Promise marker", async () => {
    const s = await scenario();
    const original = Cause.combine(Cause.fail({ reason: "controlled-checkpoint-failure" }), Cause.combine(Cause.die("native-test-defect"), Cause.interrupt(123)));
    const store = { ...s.checkpointStore, save: () => Effect.failCause(original) };
    const bridge = await Effect.runPromise(makeDurableNativeStorage({ ...s.base, checkpointStore: store }));
    await Promise.allSettled([workflow().run({ input: s.base.expectedInput, runtime: bridge.runtime,
      context: { transactionId: s.base.transactionId, preventReleaseEvents: true } })]);
    await Effect.runPromise(bridge.drain);
    const exit = await Effect.runPromiseExit(bridge.assertHealthy);
    expect(Exit.isFailure(exit) && exit.cause).toEqual(original);
    expect(inspectTrustedWorkflowInterpreterSubject(s.subject)).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
    let called = false;
    await expect(bridge.boundary(Effect.sync(() => { called = true; }))).rejects.toSatisfy(isDurableNativeBoundaryFailure);
    expect(called).toBe(false);
    expect((await Effect.runPromiseExit(bridge.assertHealthy))).toEqual(exit);
  }, 480_000);

  it("leaves native expected checkpoint control with the genuine orchestrator instead of poisoning the Task subject", async () => {
    const s = await scenario(); await s.runNative(); await Effect.runPromise(s.bridge.drain);
    await workflow().registerStepSuccess({ runtime: s.bridge.runtime,
      idempotencyKey: `${workflowId}:${s.base.transactionId}:${waitId}:invoke`, response: { id: "native-input" },
      context: { transactionId: s.base.transactionId, preventReleaseEvents: true } });
    await Effect.runPromise(s.bridge.drain);
    const checkpoint = await Effect.runPromise(s.bridge.checkpoint);
    if (checkpoint === undefined) throw new Error("Missing completed native checkpoint");
    await expect(s.bridge.runtime.storage.save(`dtrx:${workflowId}:${s.base.transactionId}`, checkpoint, undefined,
      { hasAsyncSteps: true, hasStepTimeouts: true, hasRetriesTimeout: false, stepId: `_root.${waitId}` }))
      .rejects.toSatisfy(error => error instanceof Error && SkipStepAlreadyFinishedError.isSkipStepAlreadyFinishedError(error));
    await Effect.runPromise(s.bridge.assertHealthy);
    expect(inspectTrustedWorkflowInterpreterSubject(s.subject)._tag).toBe("Success");
  }, 480_000);

  it("refuses required missing and corrupt opaque checkpoints without weakening SQL constraints", async () => {
    const missing = await scenario();
    const absent = await Effect.runPromise(makeDurableNativeStorage({ ...missing.base,
      requiredCheckpoint: { revision: 1n, sha256: new Uint8Array(32), byteLength: 1 } }));
    expect(await Effect.runPromise(Effect.result(absent.checkpoint))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    const corrupt = await scenario();
    const packet = await Effect.runPromise(corrupt.checkpointStore.prepare({ expectedRevision: 0n,
      codec: nativeCheckpointCodec, bytes: new TextEncoder().encode('{"flow":null}') }));
    await Effect.runPromise(corrupt.checkpointStore.save(corrupt.subject, packet));
    expect(await Effect.runPromise(Effect.result(corrupt.bridge.checkpoint))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  }, 480_000);

  it("bounds genuine encoded JSON before preparing another core checkpoint", async () => {
    const s = await scenario(); await s.runNative(); await Effect.runPromise(s.bridge.drain);
    const current = await Effect.runPromise(s.bridge.checkpoint);
    if (current === undefined) throw new Error("No actual checkpoint");
    const large = new TransactionCheckpoint(current.flow, { payload: "x".repeat(MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES), invoke: {}, compensate: {} });
    await expect(s.bridge.runtime.storage.save(`dtrx:${workflowId}:${s.base.transactionId}`, large)).rejects.toSatisfy(isDurableNativeBoundaryFailure);
    expect(await Effect.runPromise(Effect.result(s.bridge.assertHealthy))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }, 480_000);

  it("drains foreground and recursively added background work before closure", async () => {
    const s = await scenario();
    let releaseForeground!: () => void, releaseBackground!: () => void;
    const foreground = new Promise<void>(resolve => { releaseForeground = resolve; });
    const background = new Promise<void>(resolve => { releaseBackground = resolve; });
    let complete = false, drained = false;
    const running = s.bridge.runNative(async () => { await foreground; s.bridge.runtime.background.execute(async () => { await background; complete = true; }); });
    const draining = Effect.runPromise(s.bridge.drain).then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    releaseForeground(); await running; expect(drained).toBe(false);
    releaseBackground(); await draining; expect(complete).toBe(true);
    await Effect.runPromise(s.bridge.close);
    let called = false;
    await expect(s.bridge.boundary(Effect.sync(() => { called = true; }))).rejects.toSatisfy(isDurableNativeBoundaryFailure);
    expect(called).toBe(false);
  }, 480_000);
});
