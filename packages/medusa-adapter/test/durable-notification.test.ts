import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowRequestCancellation,
  decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1, decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { frameworkSchemaTargetSnapshot } from "../../persistence-postgres/src/installation/frameworkSchema/target";
import { createPGliteLocatedTaskSystemRunAttemptTargetV1, createPGliteDeadlineOwnedTaskPersistenceTarget } from "../../persistence-postgres/src/database/pglite";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from "../../persistence-postgres/src/database/postgres";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../persistence-postgres/src/tasks/postgresTaskExternalEffectAuthority";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../persistence-postgres/src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore } from "../../persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1";
import { issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject, revokeTrustedWorkflowExecutionSubject,
  type TrustedWorkflowExecutionSubject, type TrustedWorkflowControlSubject } from "../../persistence-postgres/src/tasks/trustedWorkflowExecutionSubject";
import { readyTaskRunAggregateV1 } from "../../persistence-postgres/test/tasks/taskSystemRunAttemptStoreTestSupport";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeCommitEventStore } from "../../persistence-postgres/src/commit/events/store";
import { makeCommitEventPump } from "../../persistence-postgres/src/commit/events/pump";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { fxSystemCommitEventEligibilityGroups } from "../../persistence-postgres/src/commit/events/eligibilitySchema";
import { fxSystemExternalEffectAttemptsV1 } from "../../persistence-postgres/src/database/schema";
import { prepareDurableNotification, type DurableNotificationEffectBoundary } from "../src/workflow/durable-notification";
import { logicalNotificationFixture } from "./support/logical-notification-fixture";
import { notificationLogger } from "./support/notification-logger";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Notification Task driver");
const cleanup: (() => Promise<void>)[] = [];
const logger = notificationLogger();
const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const subscriber = { id: "notification-task", revision: "d".repeat(64) };
const input = { to: "", channel: "feed", template: "admin-ui", data: { title: "Products imported", description: "products.csv" } };
let fixture: Awaited<ReturnType<typeof logicalNotificationFixture>>;
let tasks: Awaited<ReturnType<typeof prepareTasks>>;
let notifications: Effect.Success<ReturnType<typeof prepareDurableNotification>>;
class BoundaryFailure {
  constructor(readonly cause: Cause.Cause<unknown>) {}
}
const boundary: DurableNotificationEffectBoundary = async work => {
  const exit = await Effect.runPromiseExit(work);
  if (Exit.isFailure(exit)) throw new BoundaryFailure(exit.cause);
  return exit.value;
};
const events = () => fixture.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);

interface NotificationTaskFixture {
  readonly options: Parameters<typeof prepareDurableNotification>[0]["task"];
  readonly binding: Parameters<typeof prepareDurableNotification>[0]["task"]["binding"];
  readonly create: () => Promise<{ readonly subject: TrustedWorkflowExecutionSubject; readonly control: () => Promise<TrustedWorkflowControlSubject> }>;
}
async function prepareTasks(): Promise<NotificationTaskFixture> {
  const selected = fixture.fixture;
  const located = await Effect.runPromise(resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId: selected.deploymentId,
    scopeId: selected.hostInput.scopeId }, selected.hostInput.authority));
  const snapshot = frameworkSchemaTargetSnapshot(selected.bindingTarget);
  if (snapshot === undefined) throw new Error("Missing real logical target");
  const persistence = selected.persistence;
  const target = "pool" in persistence ? createPostgresLocatedTaskSystemRunAttemptTargetV1(persistence, snapshot.physicalLocator)
    : createPGliteLocatedTaskSystemRunAttemptTargetV1(persistence, snapshot.physicalLocator);
  const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000, statementTimeoutMilliseconds: 4000,
    transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
  const resource = "pool" in persistence ? Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
    connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 2 }, snapshot.physicalLocator, deadlines)) : undefined;
  if (resource !== undefined) cleanup.push(resource.close);
  const transactionTarget = "pool" in persistence ? resource?.target :
    Result.getOrThrow(createPGliteDeadlineOwnedTaskPersistenceTarget(persistence, snapshot.physicalLocator, deadlines));
  if (transactionTarget === undefined) throw new Error("Missing actual bounded Task resource");
  const canonical = await Effect.runPromise(canonicalizeFlarexValueV1Effect({ version: 1, scopeId: located.authority.scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|notification", subject: "notification", issuer: "issuer", roles: [] } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  const binding = await Effect.runPromise(prepareTrustedWorkflowTaskBinding({ scopeId: located.authority.scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: "native-local-notification-test",
    executionPolicy: { notification: "native-two-phases", callback: "actual-local" }, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: { ...readyTaskRunAggregateV1().boundPolicy, leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(60_000)) } }, hash));
  const options = { authority: located.authority, target: transactionTarget, binding, principal,
    principalCanonicalBytes: canonical.canonicalBytes, sha256: hash };
  const creation = makeTrustedWorkflowTaskRunCreationStore(options);
  const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore({ authority: located.authority, target });
  const create = async () => {
    const created = await Effect.runPromise(creation.createRun({ requestKey: `notification-${randomUUID()}`, principal,
      input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(3), 1)) }));
    const initial = await Effect.runPromise(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
    const granted = await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
      decide: current => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
        expectedRunVersion: initial.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)) }, current) }));
    if (granted.outcome.kind !== "attempt_granted") throw new Error("Expected genuine grant");
    const identity = { runId: created.runId, ...granted.outcome.grant.attempt };
    await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
      decide: current => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...identity,
        heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, current) }));
    const subject = await Effect.runPromise(issueTrustedWorkflowExecutionSubject(identity, options));
    const control = async () => {
      await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: created.runId,
        decide: current => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: created.runId,
          reason: { code: "requested", message: null } }, current) }));
      return await Effect.runPromise(issueTrustedWorkflowControlSubject(identity, options));
    };
    return { subject, control };
  };
  return { options, binding, create };
}

describe("actual native Notification Task phases, provider journal and conjunctive delivery gates", () => {
  beforeAll(async () => {
    fixture = await logicalNotificationFixture(driver, close => cleanup.push(close), logger);
    const bootstrap = await Effect.runPromise(makeCommerceHost(fixture.hostInput));
    try { await Effect.runPromise(bootstrap.run(bootstrap.newRequestKey(), fixture.runtime.registerLocalProvider,
      { id: "local", handle: "local", name: "local", is_enabled: true, channels: ["feed"] })); }
    finally { await Effect.runPromise(bootstrap.close); }
    tasks = await prepareTasks();
    notifications = await Effect.runPromise(prepareDurableNotification({ runtime: fixture.runtime,
      logicalStorage: fixture.hostInput.logicalStorage, revision: "c".repeat(64), subscribers: [subscriber],
      task: tasks.options, maximumCallbackMs: 1000,
      execution: { identityAndAccessPolicy: { profile: "native-notification-task-test" },
        prepare: composition => makeAtomicCommerceHost({ ...fixture.fixture.hostInput, ...composition, taskBinding: tasks.binding }) },
    }));
    cleanup.push(() => Effect.runPromise(notifications.close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("replays native delivery without resending or duplicate intents and requires both actual role and parent release", async () => {
    const task = await tasks.create();
    const before = await events();
    const native = notifications.serviceFor("success", task.subject, boundary);
    const result = await native.createNotifications([input]);
    expect(result).toMatchObject([{ status: "success", provider_id: "local" }]);
    const after = await events();
    expect(after.slice(before.length)).toHaveLength(2);
    expect(after.slice(before.length).every(row => row.envelope.eligibility?.length === 2)).toBe(true);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const groups = await fixture.fixture.persistence.drizzle.select().from(fxSystemCommitEventEligibilityGroups);
    expect(groups.filter(group => group.maximumCommits === 2)).toMatchObject([{ state: "released", memberCount: 2 }]);
    expect(groups.filter(group => group.maximumCommits === 5)).toMatchObject([{ state: "held", memberCount: 2 }]);
    expect(await notifications.serviceFor("success", task.subject, boundary).createNotifications([input])).toEqual(result);
    expect(logger.info).toHaveBeenCalledTimes(1); expect(await events()).toEqual(after);
    const store = await Effect.runPromise(makeCommitEventStore(fixture.fixture.hostInput));
    for (const row of after.slice(before.length)) expect(await Effect.runPromise(store.claimBatch(row.commitSeq, [subscriber], 8))).toEqual([]);
    await Effect.runPromise(notifications.decideParent(task.subject, "released"));
    let delivered = 0;
    const pump = await Effect.runPromise(makeCommitEventPump(fixture.fixture.hostInput,
      [{ ...subscriber, handle: () => Effect.sync(() => { delivered++; }) }]));
    const first = await Effect.runPromise(pump.runNext()); await Effect.runPromise(pump.runNext(first.cursor));
    expect(delivered).toBe(2);
    const receipts = await fixture.fixture.persistence.drizzle.select().from(fxSystemExternalEffectAttemptsV1);
    expect(receipts.filter(row => row.effectKind === "trusted_callback")).toMatchObject([{ state: "confirmed", effectOrdinal: 1n }]);
    revokeTrustedWorkflowExecutionSubject(task.subject);
  }, 120_000);

  it("allows only failure Notification on a genuine control subject and preserves known native provider failure with held intents", async () => {
    const task = await tasks.create(), control = await task.control();
    expect(() => notifications.serviceFor("success", control, boundary)).toThrow();
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error("known local provider failure"); });
    const before = await events();
    await expect(notifications.serviceFor("failure", control, boundary).createNotifications([input])).rejects.toThrow(/known local provider failure/);
    const after = await events();
    expect(after.slice(before.length)).toHaveLength(2);
    const store = await Effect.runPromise(makeCommitEventStore(fixture.fixture.hostInput));
    await Effect.runPromise(notifications.decideParent(control, "released"));
    for (const row of after.slice(before.length)) expect(await Effect.runPromise(store.claimBatch(row.commitSeq, [subscriber], 8))).toEqual([]);
    await Effect.runPromise(notifications.clearRole(control, "failure"));
    for (const row of after.slice(before.length)) expect(await Effect.runPromise(store.claimBatch(row.commitSeq, [subscriber], 8))).toEqual([]);
    const receipts = await fixture.fixture.persistence.drizzle.select().from(fxSystemExternalEffectAttemptsV1);
    expect(receipts.filter(row => row.effectKind === "trusted_callback" && row.effectOrdinal === 2n))
      .toMatchObject([{ state: "confirmed", trustedCallbackOutcomeJson: { kind: "failed", error: { message: "known local provider failure" } } }]);
    revokeTrustedWorkflowExecutionSubject(control); revokeTrustedWorkflowExecutionSubject(task.subject);
  }, 120_000);

  it("keeps unknown callback Cause sticky across native finally and the compensating role without another phase or send", async () => {
    const task = await tasks.create();
    const foreign = { unknown: "provider result lost" };
    vi.mocked(logger.info).mockImplementationOnce(() => { throw foreign; });
    const before = await events();
    const failed: unknown = await notifications.serviceFor("success", task.subject, boundary).createNotifications([input])
      .catch((cause: unknown) => cause);
    expect(failed).toBeInstanceOf(BoundaryFailure);
    if (!(failed instanceof BoundaryFailure)) throw new Error("Expected actual core boundary failure");
    expect(failed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === foreign)).toBe(true);
    const after = await events();
    expect(after.slice(before.length)).toHaveLength(1);
    const sends = vi.mocked(logger.info).mock.calls.length;
    const compensated: unknown = await notifications.serviceFor("failure", task.subject, boundary).createNotifications([input])
      .catch((cause: unknown) => cause);
    expect(compensated).toBeInstanceOf(BoundaryFailure);
    if (!(compensated instanceof BoundaryFailure)) throw new Error("Expected same core boundary failure");
    expect(compensated.cause).toEqual(failed.cause);
    expect(await events()).toEqual(after); expect(logger.info).toHaveBeenCalledTimes(sends);
    const receipts = await fixture.fixture.persistence.drizzle.select().from(fxSystemExternalEffectAttemptsV1);
    expect(receipts.filter(row => row.effectKind === "trusted_callback" && row.state === "dispatching"))
      .toMatchObject([{ trustedCallbackOutcomeJson: null, trustedCallbackOutcomeSha256: null }]);
    await Effect.runPromise(notifications.decideParent(task.subject, "cleared"));
    revokeTrustedWorkflowExecutionSubject(task.subject);
  }, 120_000);
});
