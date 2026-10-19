import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { makeTaskExecutionPrincipalReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decodeTaskDurationMsV1, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import type { TaskAtomicCommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { frameworkSchemaTargetSnapshot } from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import { createPGliteDeadlineOwnedTaskRunAttemptTarget } from "../../../persistence-postgres/src/database/pglite";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../../persistence-postgres/src/tasks/postgresTaskExternalEffectAuthority";
import { makeTrustedWorkflowCheckpointStore } from "../../../persistence-postgres/src/tasks/trustedWorkflowCheckpoint";
import { makeTrustedWorkflowContinuationStore } from "../../../persistence-postgres/src/tasks/trustedWorkflowContinuationStore";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../../persistence-postgres/src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore } from "../../../persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1";
import { issueTrustedWorkflowExecutionSubject, revokeTrustedWorkflowExecutionSubject } from "../../../persistence-postgres/src/tasks/trustedWorkflowExecutionSubject";
import { readyTaskRunAggregateV1 } from "../../../persistence-postgres/test/tasks/taskSystemRunAttemptStoreTestSupport";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareFulfillmentDeliveryDatabase } from "../../src/workflows/fulfillment/delivery-database";
import { makeFulfillmentDeliveryInterpreter } from "../../src/workflows/fulfillment/delivery";
import { makeFulfillmentDeliveryTask } from "../../src/workflows/fulfillment/delivery-task";
import { fulfillmentDeliveryPolicy, fulfillmentDeliveryProfile } from "../../src/workflows/fulfillment/delivery-input";
import { makeFulfillmentDeliveryLocking } from "../../src/workflow/durable-locking";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareLogicalFulfillmentShipment } from "./logical-fulfillment-shipment-fixture";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
export const fulfillmentDeliverySubscriber = { id: "native-fulfillment-delivery", revision: "9".repeat(64) };
type Task = Parameters<typeof makeFulfillmentDeliveryTask>[0];
type Interpreter = Effect.Success<ReturnType<typeof makeFulfillmentDeliveryInterpreter>>;
type ExecuteInput = Parameters<Interpreter["execute"]>[0];
type Finished = Effect.Success<ReturnType<Interpreter["execute"]>>;
type CheckpointStore = ReturnType<typeof makeTrustedWorkflowCheckpointStore>;
type Locking = Effect.Success<ReturnType<typeof makeFulfillmentDeliveryLocking>>;
type Lifecycle = ReturnType<typeof makeTrustedWorkflowTaskSystemRunAttemptStore>;
type PreparedDelivery = {
  readonly driver: Effect.Success<ReturnType<typeof makeFulfillmentDeliveryTask>>;
  readonly interpreter: Interpreter;
  readonly database: Effect.Success<ReturnType<typeof prepareFulfillmentDeliveryDatabase>>;
  readonly locking: Locking;
};
interface DeliveryFixture {
  readonly connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentShipment>>;
  readonly task: Task;
  readonly control: Effect.Success<ReturnType<typeof makeTrustedWorkflowContinuationStore>>;
  readonly locking: Locking;
  readonly prepare: (options?: Preparation) => Promise<PreparedDelivery>;
  readonly createLockProbe: (inputReference: unknown, id: string) => Promise<{
    readonly subject: Effect.Success<ReturnType<typeof issueTrustedWorkflowExecutionSubject>>;
    readonly service: ReturnType<Locking["serviceFor"]>;
    readonly ownerId: string;
    readonly complete: () => Promise<Effect.Success<ReturnType<Lifecycle["transactRunAttempt"]>>>;
  }>;
  readonly closeCaseHosts: () => Promise<void>;
}
interface Preparation {
  readonly checkpointStore?: (store: CheckpointStore) => CheckpointStore;
  /** Observes the actual interpreter outcome before the real Task driver
   * inspects cancellation and completes its still-live attempt. */
  readonly afterExecute?: (input: ExecuteInput, outcome: Finished) => Effect.Effect<void, unknown>;
}

/** Real twelve-table module seeds and shared native Locking lifecycle; the
 * existing Task persistence/checkpoint/subject owners supply all authority. */
export async function logicalFulfillmentDeliveryFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void): Promise<DeliveryFixture> {
  const connected = await prepareLogicalFulfillmentShipment(driver, close), fixture = connected.fixture;
  const located = await Effect.runPromise(resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId: fixture.deploymentId,
    scopeId: fixture.hostInput.scopeId }, fixture.hostInput.authority));
  const snapshot = frameworkSchemaTargetSnapshot(fixture.bindingTarget);
  if (snapshot === undefined) throw new Error("Missing genuine Delivery target");
  const persistence = fixture.persistence;
  const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
    statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
  const resource = "pool" in persistence ? Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
    connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 2,
  }, snapshot.physicalLocator, deadlines)) : undefined;
  if (resource !== undefined) close(resource.close);
  const target = "pool" in persistence ? resource?.lifecycleTarget :
    Result.getOrThrow(createPGliteDeadlineOwnedTaskRunAttemptTarget(persistence, snapshot.physicalLocator, deadlines));
  if (target === undefined) throw new Error("Missing deadline-owned Delivery Task resource");
  const principalBytes = await Effect.runPromise(canonicalizeFlarexValueV1Effect({ version: 1, scopeId: located.authority.scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|delivery", subject: "delivery", issuer: "issuer" } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(principalBytes.sha256, principalBytes.canonicalBytes.byteLength));
  const policy = readyTaskRunAggregateV1().boundPolicy;
  const binding = await Effect.runPromise(prepareTrustedWorkflowTaskBinding({ scopeId: located.authority.scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: fulfillmentDeliveryProfile,
    executionPolicy: fulfillmentDeliveryPolicy, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: { ...policy, maximumDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(180_000)),
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(180_000)) } }, hash));
  const task: Task = { authority: located.authority, target, binding, principal,
    principalCanonicalBytes: principalBytes.canonicalBytes, sha256: hash };
  const control = await Effect.runPromise(makeTrustedWorkflowContinuationStore(task));
  const execution: AtomicWorkflowExecution<TaskAtomicCommerceHost> = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition,
      executionIsolation: "scopeExclusive", taskBinding: binding }),
  };
  const revision = "9".repeat(64), locking = await Effect.runPromise(makeFulfillmentDeliveryLocking({ task, revision }));
  close(() => Effect.runPromise(locking.close));
  const caseHosts: Array<() => Promise<void>> = [];
  const closeCaseHosts = async () => {
    for (const dispose of caseHosts.splice(0).reverse()) await dispose();
    await connected.closeCaseHosts();
  };
  close(closeCaseHosts);
  /** A second genuine Task grant drives only the selected native callback
   * contract. It is a resource-ownership probe, not a second full Delivery. */
  const createLockProbe = async (inputReference: unknown, id: string) => {
    const creation = makeTrustedWorkflowTaskRunCreationStore(task), lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(task);
    const created = await Effect.runPromise(creation.createRun({ requestKey: globalThis.crypto.randomUUID(), input: inputReference, principal }));
    const current = await Effect.runPromise(control.inspect(created.runId));
    const started = await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
        expectedRunVersion: current.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
    if (started.outcome.kind !== "attempt_granted" || started.disposition !== "accepted") throw new Error("Missing genuine second Locking Task grant");
    const identity = { runId: created.runId, ...started.outcome.grant.attempt };
    await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...identity,
        heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
    const subject = await Effect.runPromise(issueTrustedWorkflowExecutionSubject(identity, task));
    caseHosts.push(async () => { revokeTrustedWorkflowExecutionSubject(subject); });
    const service = locking.serviceFor({ subject, id, boundary: work => Effect.runPromise(work) });
    const complete = () => Effect.runPromise(lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...identity,
        completion: { kind: "succeeded", result: null, executionDurationMs: null } }, value) }).pipe(
          Effect.ensuring(Effect.sync(() => revokeTrustedWorkflowExecutionSubject(subject)))));
    return { subject, service, ownerId: `fulfillment-delivery:${created.runId}`, complete };
  };
  const prepare = async (options: Preparation = {}) => {
    const database = await Effect.runPromise(prepareFulfillmentDeliveryDatabase({ execution,
      modules: connected.shipmentModules, revision, subscribers: [fulfillmentDeliverySubscriber] }));
    caseHosts.push(() => Effect.runPromise(database.close));
    const checkpointStore = makeTrustedWorkflowCheckpointStore(task);
    const original = await Effect.runPromise(makeFulfillmentDeliveryInterpreter({ task, database, locking, revision,
      checkpointStore: options.checkpointStore?.(checkpointStore) ?? checkpointStore, runEffect: work => Effect.runPromise(work) }));
    const observe = options.afterExecute;
    const interpreter = observe === undefined ? original : { ...original,
      execute: Effect.fn("DeliveryFixture.observeExecution")(function* (input: ExecuteInput) {
        const outcome = yield* original.execute(input);
        yield* observe(input, outcome);
        return outcome;
      }),
    };
    const taskDriver = await Effect.runPromise(makeFulfillmentDeliveryTask(task, interpreter));
    return { driver: taskDriver, interpreter, database, locking };
  };
  return { connected, task, control, locking, prepare, createLockProbe, closeCaseHosts };
}
