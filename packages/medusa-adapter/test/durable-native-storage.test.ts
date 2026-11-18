import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decodeTaskRetryJitterV1,
  decodeTaskHeartbeatSequenceV1, MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES } from "@flarex/durable-task/internal/run-attempt-v1";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/workflows-sdk/durable";
import { execution } from "@medusajs/workflows-sdk/testing/native-runtime";
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
import { makeDurableNativeStorage, isDurableNativeBoundaryFailure, nativeCheckpointCodec, nativeCompoundCheckpointCodec } from "../src/workflow/durable-native-storage";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

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
const compoundWorkflowId = "native-stored-child-parent-proof";
const compoundChildId = "native-stored-child-proof";
const compoundChildStepId = `${compoundChildId}-as-step`;
interface NeutralChildService { read(): Promise<string>; write(value: string): Promise<void> }
const childInputSchema = Schema.Struct({ id: Schema.String, value: Schema.String });
const decodeChildInput = Schema.decodeUnknownResult(childInputSchema, { onExcessProperty: "error" });
const change = createStep("native-stored-child-change", async (input: { id: string; value: string }, { container }) => {
  const service = container.resolve<NeutralChildService>("neutralChild");
  const previous = await service.read();
  await service.write(input.value);
  return new StepResponse(input, previous);
}, async (previous, { container }) => {
  if (previous !== undefined) await container.resolve<NeutralChildService>("neutralChild").write(previous);
});
const storedChild = createWorkflow({ name: compoundChildId, store: true, storeExecution: true },
  (input: { id: string; value: string }) => new WorkflowResponse(change(input)));
const storedParent = createWorkflow({ name: compoundWorkflowId, store: true, storeExecution: true }, (input: { id: string }) =>
  new WorkflowResponse(storedChild.runAsStep({ input: transform(input, value => ({ id: value.id, value: "after" })) })));

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

async function compoundScenario() {
  const s = await scenario();
  const values: string[] = [];
  let value = "before";
  const { container } = execution();
  container.values.set("neutralChild", {
    async read() { return value; },
    async write(next: string) { value = next; values.push(next); },
  } satisfies NeutralChildService);
  const childTransactionId = `${compoundChildStepId}-${s.base.transactionId}`;
  const base = { subject: s.subject, checkpointStore: s.checkpointStore, runEffect: Effect.runPromise,
    workflowId: compoundWorkflowId, transactionId: s.base.transactionId, expectedInput: s.base.expectedInput,
    expectedEventGroupId: s.base.transactionId, clock: s.base.clock,
    checkpointedChild: { workflowId: compoundChildId, transactionId: childTransactionId, parentStepId: compoundChildStepId,
      validateInput: (input: unknown) => decodeChildInput(input).pipe(
        Result.mapError(cause => commerceError("storedCorruption", cause)),
        Result.flatMap(child => child.id === s.base.expectedInput.id && child.value === "after"
          ? Result.succeed(undefined) : Result.fail(commerceError("storedCorruption")))),
    } };
  const bridge = await Effect.runPromise(makeDurableNativeStorage(base));
  const run = () => storedParent(container).run({ input: base.expectedInput, runtime: bridge.runtime,
    context: { transactionId: base.transactionId, eventGroupId: base.expectedEventGroupId } });
  const cold = () => Effect.runPromise(makeDurableNativeStorage(base));
  return { ...s, base, bridge, container, values, value: () => value, run, cold, childTransactionId };
}

const decodeJsonObject = Schema.decodeUnknownResult(Schema.JsonObject);
const jsonObject = (value: unknown) => Result.getOrThrow(decodeJsonObject(value));

describe(`native checkpoint bridge - ${driver}`, { concurrent: false }, () => {
  it("retains a genuine synchronous child and runs its original preimage inverse after cold hydration", async () => {
    const s = await compoundScenario();
    const forward = await s.run();
    await Effect.runPromise(s.bridge.drain); await Effect.runPromise(s.bridge.assertHealthy);
    expect(forward.transaction.getState()).toBe("done");
    expect(s.value()).toBe("after");
    const saved = await Effect.runPromise(s.checkpointStore.load(s.subject));
    if (Option.isNone(saved)) throw new Error("Missing actual compound Task checkpoint");
    expect(saved.value.codec).toBe(nativeCompoundCheckpointCodec);
    const packet = jsonObject(JSON.parse(new TextDecoder().decode(saved.value.bytes)));
    const child = jsonObject(packet.child), parent = jsonObject(packet.parent);
    expect(jsonObject(child.flow)).toMatchObject({ modelId: compoundChildId, transactionId: s.childTransactionId, state: "done" });
    expect(jsonObject(child.flow).runId).toBe(jsonObject(parent.flow).runId);
    expect(jsonObject(jsonObject(child.flow).metadata)).toMatchObject({
      eventGroupId: s.base.expectedEventGroupId, preventReleaseEvents: true,
      parentStepIdempotencyKey: `${compoundWorkflowId}:${s.base.transactionId}:${compoundChildStepId}:invoke`,
    });
    const cold = await s.cold();
    const childCheckpoint = await cold.runtime.storage.get(`dtrx:${compoundChildId}:${s.childTransactionId}`);
    expect(childCheckpoint).toBeInstanceOf(TransactionCheckpoint);
    const canceled = await storedParent(s.container).cancel({ runtime: cold.runtime, transactionId: s.base.transactionId,
      context: { eventGroupId: s.base.expectedEventGroupId } });
    await Effect.runPromise(cold.drain); await Effect.runPromise(cold.assertHealthy);
    expect(canceled.transaction.getState()).toBe("reverted");
    expect(s.values).toEqual(["after", "before"]);
    expect((await cold.runtime.storage.get(`dtrx:${compoundChildId}:${s.childTransactionId}`))?.flow.state).toBe("reverted");
    expect(await Effect.runPromise(cold.waitProposal)).toBeUndefined();
    await Effect.runPromise(s.bridge.close); await Effect.runPromise(cold.close);
  }, 480_000);

  it.each(["missing-child", "foreign-model", "foreign-run", "payload", "parent-key", "event-group", "topology", "retained-id"] as const)(
    "refuses compound checkpoint corruption before another business callback: %s", async violation => {
      const s = await compoundScenario(); await s.run(); await Effect.runPromise(s.bridge.drain);
      const saved = await Effect.runPromise(s.checkpointStore.load(s.subject));
      if (Option.isNone(saved)) throw new Error("Missing actual compound checkpoint");
      let packet = jsonObject(JSON.parse(new TextDecoder().decode(saved.value.bytes)));
      const child = jsonObject(packet.child), flow = jsonObject(child.flow), metadata = jsonObject(flow.metadata);
      switch (violation) {
        case "missing-child": packet = { ...packet, child: null }; break;
        case "foreign-model": packet = { ...packet, child: { ...child, flow: { ...flow, modelId: "foreign-child" } } }; break;
        case "foreign-run": packet = { ...packet, child: { ...child, flow: { ...flow, runId: "foreign-run" } } }; break;
        case "payload": packet = { ...packet, child: { ...child, context: { ...jsonObject(child.context), payload: { id: "foreign", value: "after" } } } }; break;
        case "parent-key": packet = { ...packet, child: { ...child, flow: { ...flow, metadata: { ...metadata, parentStepIdempotencyKey: "foreign" } } } }; break;
        case "event-group": packet = { ...packet, child: { ...child, flow: { ...flow, metadata: { ...metadata, eventGroupId: "foreign" } } } }; break;
        case "topology": packet = { ...packet, child: { ...child, flow: { ...flow, definition: { foreign: true } } } }; break;
        case "retained-id": {
          const parent = jsonObject(packet.parent), context = jsonObject(parent.context), invoke = jsonObject(context.invoke);
          const step = jsonObject(invoke[compoundChildStepId]), output = jsonObject(step.output), compensation = jsonObject(output.compensateInput);
          const transaction = jsonObject(compensation.transaction);
          packet = { ...packet, parent: { ...parent, context: { ...context, invoke: { ...invoke, [compoundChildStepId]: { ...step,
            output: { ...output, compensateInput: { ...compensation, transaction: { ...transaction, transactionId: "foreign" } } },
          } } } } };
          break;
        }
      }
      const prepared = await Effect.runPromise(s.checkpointStore.prepare({ expectedRevision: saved.value.revision,
        codec: nativeCompoundCheckpointCodec, bytes: new TextEncoder().encode(JSON.stringify(packet)) }));
      await Effect.runPromise(s.checkpointStore.save(s.subject, prepared));
      const cold = await s.cold();
      await expect(cold.runtime.storage.get(`dtrx:${compoundWorkflowId}:${s.base.transactionId}`))
        .rejects.toSatisfy(isDurableNativeBoundaryFailure);
      expect(await Effect.runPromise(Effect.result(cold.assertHealthy))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(s.values).toEqual(["after"]);
      expect(inspectTrustedWorkflowInterpreterSubject(s.subject)._tag).toBe("Failure");
    }, 480_000);

  it("refuses another child namespace and preserves the first compound failure", async () => {
    const s = await compoundScenario(); await s.run(); await Effect.runPromise(s.bridge.drain);
    await expect(s.bridge.runtime.storage.get(`dtrx:${compoundChildId}:${s.childTransactionId}-attempt-2`))
      .rejects.toSatisfy(isDurableNativeBoundaryFailure);
    expect(await Effect.runPromise(Effect.result(s.bridge.assertHealthy))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const first = await Effect.runPromiseExit(s.bridge.assertHealthy);
    await expect(s.bridge.runtime.storage.get(`dtrx:${compoundChildId}:${s.childTransactionId}`))
      .rejects.toSatisfy(isDurableNativeBoundaryFailure);
    expect(await Effect.runPromiseExit(s.bridge.assertHealthy)).toEqual(first);
    expect(s.values).toEqual(["after"]);
  }, 480_000);

  it("serializes parent and child saves through one authenticated Task revision", async () => {
    const s = await compoundScenario(); await s.run(); await Effect.runPromise(s.bridge.drain);
    const parentKey = `dtrx:${compoundWorkflowId}:${s.base.transactionId}`;
    const childKey = `dtrx:${compoundChildId}:${s.childTransactionId}`;
    const parent = await s.bridge.runtime.storage.get(parentKey), child = await s.bridge.runtime.storage.get(childKey);
    if (parent === undefined || child === undefined) throw new Error("Missing actual native parent or child");
    const before = await Effect.runPromise(s.checkpointStore.load(s.subject));
    if (Option.isNone(before)) throw new Error("Missing actual Task revision");
    let active = 0, maximum = 0;
    const save = s.checkpointStore.save;
    const checkpointStore = { ...s.checkpointStore, save: (...args: Parameters<typeof save>) => Effect.gen(function* () {
      active++; maximum = Math.max(maximum, active);
      return yield* save(...args).pipe(Effect.ensuring(Effect.sync(() => { active--; })));
    }) };
    const cold = await Effect.runPromise(makeDurableNativeStorage({ ...s.base, checkpointStore }));
    await Promise.all([cold.runtime.storage.save(parentKey, parent), cold.runtime.storage.save(childKey, child)]);
    await Effect.runPromise(cold.assertHealthy);
    const after = await Effect.runPromise(s.checkpointStore.load(s.subject));
    if (Option.isNone(after)) throw new Error("Missing saved compound revision");
    expect(maximum).toBe(1);
    expect(after.value.revision).toBe(before.value.revision + 2n);
    expect(after.value.codec).toBe(nativeCompoundCheckpointCodec);
    expect(s.values).toEqual(["after"]);
  }, 480_000);

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
