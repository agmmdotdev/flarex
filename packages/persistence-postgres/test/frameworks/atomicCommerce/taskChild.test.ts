import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1,
  prepareTrustedWorkflowTaskBinding, type TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowCompleteAttempt,
  decideTrustedWorkflowRequestCancellation, decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1,
  decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import type { Json } from "flarex-protocol/json";
import { createPGliteLocatedTaskSystemRunAttemptTargetV1, createPGliteDeadlineOwnedTaskPersistenceTarget } from "../../../src/database/pglite";
import { createPostgresLocatedTaskSystemRunAttemptTargetV1 } from "../../../src/database/postgres";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../../src/tasks/postgresTaskExternalEffectAuthority";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { fxSystemExternalEffectAttemptsV1 } from "../../../src/database/schema";
import { fxSystemCommitEvents } from "../../../src/commit/events/schema";
import { fxSystemCommitEventEligibilityMembers } from "../../../src/commit/events/eligibilitySchema";
import { makeCommitEventEligibilityStore, prepareCommitEventEligibility } from "../../../src/commit/events/eligibility";
import { makeCommitEventPump } from "../../../src/commit/events/pump";
import { makeCommitEventStore } from "../../../src/commit/events/store";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../../src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore } from "../../../src/tasks/taskSystemRunAttemptStoreV1";
import { issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject, revokeTrustedWorkflowExecutionSubject,
  type TrustedWorkflowExecutionSubject } from "../../../src/tasks/trustedWorkflowExecutionSubject";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../src/scope/scopeAuthorityResolution";
import { frameworkSchemaTargetSnapshot } from "../../../src/installation/frameworkSchema/target";
import { defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type AtomicCommerceCommand } from "../../../src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../../src/frameworks/atomicCommerce/host";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { readyTaskRunAggregateV1 } from "../../tasks/taskSystemRunAttemptStoreTestSupport";
import { commerceHostFixture, type CommerceHostTestFixture } from "../commerceTransaction/commerceHostFixture";
import { prepareNeutralCommerceProfile } from "../commerceTransaction/neutralCommerceProfile";
import { commerceInventory } from "../commerceTransaction/commerceInventory";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let callbacks = 0;
const participant = defineAtomicCommerceParticipant("taskItem");
const decodeRow = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String, value: Schema.Int }), { onExcessProperty: "error" });
const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const subscriber = { id: "task-child-witness", revision: "c".repeat(64) };
const event = defineCommerceEventContract({ name: "task.item", revision: "a".repeat(64), internal: true,
  decode: input => decodeRow(input).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause))) });
const write = defineCommerceCommand("taskWrite", "write", Effect.fn(function* (ctx, input) {
  const row = yield* decodeRow(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const table = yield* ctx.table("task_item");
  return [...yield* table.write(ctx.manager, "insert", [row])];
}));
const writeRoot = defineAtomicCommerceCommand("taskWriteRoot", Effect.fn(function* (ctx, input) {
  callbacks++;
  const rows = yield* ctx.call(participant, write, input);
  yield* ctx.emit(event, input);
  return rows;
}));
const otherRoot = defineAtomicCommerceCommand("taskOtherRoot", Effect.fn(function* (ctx, input) {
  callbacks++;
  return yield* ctx.call(participant, write, input);
}));

function hostInput(taskBinding?: TrustedWorkflowTaskBinding, commands: readonly AtomicCommerceCommand[] = [writeRoot, otherRoot]): AtomicCommerceHostInput<unknown> {
  return { ...fixture.hostInput, executionIsolation: "scopeExclusive", commands, ...(taskBinding === undefined ? {} : { taskBinding }),
    participants: [{ participant, profile: fixture.prepared.profile, installation: fixture.installation,
      commands: [write], validate: () => Effect.void }],
    events: { producerRevision: "b".repeat(64), contracts: [event], subscribers: [subscriber], validate: () => Effect.void } };
}
async function openHost(input: AtomicCommerceHostInput<unknown>) {
  const host = await runEffect(makeAtomicCommerceHost(input));
  cleanup.push(() => runEffect(host.close));
  return host;
}
const row = (id: string) => ({ id, value: 1 });
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const effects = () => fixture.persistence.drizzle.select().from(fxSystemExternalEffectAttemptsV1)
  .where(eq(fxSystemExternalEffectAttemptsV1.effectKind, "child_commerce"));
const inventory = async () => ({ commerce: await commerceInventory(fixture), events: await events(), effects: await effects() });

beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid task commerce driver");
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepareNeutralCommerceProfile(["task_item"], "task-child"),
    [write], control, () => ({ capture: () => Effect.fail(commerceError("unadmittedEvent")),
      validate: () => Effect.void, deliver: () => Effect.void }));
  cleanup.push(() => runEffect(fixture.host.close));
}, 480_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 480_000);

async function liveTask(leaseMs = 45_000) {
  const { database, scopeId, deploymentId, authority: ports } = fixture.hostInput;
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, ports));
  const snapshot = frameworkSchemaTargetSnapshot(fixture.cms.target);
  if (snapshot === undefined) throw new Error("Missing actual fixture target");
  const persistence = fixture.persistence;
  const target = "pool" in persistence ? createPostgresLocatedTaskSystemRunAttemptTargetV1(persistence, snapshot.physicalLocator) :
    createPGliteLocatedTaskSystemRunAttemptTargetV1(persistence, snapshot.physicalLocator);
  const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
    statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
  const boundedResource = "pool" in persistence ? Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
    connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 2,
  }, snapshot.physicalLocator, deadlines)) : undefined;
  if (boundedResource !== undefined) cleanup.push(boundedResource.close);
  const transactionTarget = "pool" in persistence ? boundedResource?.target :
    Result.getOrThrow(createPGliteDeadlineOwnedTaskPersistenceTarget(persistence, snapshot.physicalLocator, deadlines));
  if (transactionTarget === undefined) throw new Error("Missing actual deadline-owned Task resource");
  const canonical = await runEffect(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|operator", subject: "operator", issuer: "issuer" } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  const binding = await runEffect(prepareTrustedWorkflowTaskBinding({ scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: "neutral-task-child",
    executionPolicy: { commands: ["taskWriteRoot", "taskOtherRoot"] }, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: { ...readyTaskRunAggregateV1().boundPolicy, leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(leaseMs)) } }, hash));
  const store = makeTrustedWorkflowTaskRunCreationStore({ authority: located.authority, target: transactionTarget, binding, sha256: hash });
  const created = await runEffect(store.createRun({ requestKey: `child-${randomUUID()}`, principal,
    input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x22), 1)) }));
  const lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore({ authority: located.authority, target });
  const grant = async () => {
    const initial = await runEffect(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
    const started = await runEffect(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
        expectedRunVersion: initial.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
    if (started.outcome.kind !== "attempt_granted") throw new Error(`Expected attempt grant, got ${started.outcome.kind}`);
    const identity = { runId: created.runId, ...started.outcome.grant.attempt };
    await runEffect(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", runId: created.runId,
        attemptId: identity.attemptId, executionFence: identity.executionFence,
        heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
    return identity;
  };
  const issue = (identity: Awaited<ReturnType<typeof grant>>) => issueTrustedWorkflowExecutionSubject(identity, {
    authority: located.authority, target: transactionTarget, binding, principal, principalCanonicalBytes: canonical.canonicalBytes, sha256: hash,
  });
  const identity = await grant();
  const subject = await runEffect(issue(identity));
  const issueControl = () => issueTrustedWorkflowControlSubject(identity, {
    authority: located.authority, target: transactionTarget, binding, principal, principalCanonicalBytes: canonical.canonicalBytes, sha256: hash,
  });
  return { database, lifecycle, identity, subject, issue, issueControl, grant, binding };
}

describe(`Task-owned atomic commerce - ${driver}`, () => {
  it("recovers an allowlisted cleanup occurrence across ordinary and cancellation authority without repeating its write", async () => {
    const task = await liveTask(), selected = { ...hostInput(task.binding), taskControlCommands: [writeRoot] };
    const host = await openHost(selected), count = callbacks;
    const args = row("authority-replay-" + randomUUID());
    const result = await runEffect(host.runTaskChild(task.subject, 1n, writeRoot, args));
    const committed = await inventory();
    await runEffect(task.lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: task.identity.runId,
      decide: value => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: task.identity.runId,
        reason: { code: "requested", message: null } }, value) }));
    const control = await runEffect(task.issueControl()), cold = await openHost(selected);
    expect(await runEffect(cold.runControlChild(control, 1n, writeRoot, args))).toEqual(result);
    expect(await inventory()).toEqual(committed); expect(callbacks).toBe(count + 1);
    expect(await runEffectFailure(cold.runTaskChild(task.subject, 1n, writeRoot, args)))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await runEffectFailure(cold.runControlChild(control, 1n, otherRoot, args)))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await runEffectFailure(cold.runControlChild(control, 1n, writeRoot, { ...args, value: 2 })))
      .toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(committed); expect(callbacks).toBe(count + 1);
  }, 480_000);

  it("admits control cleanup only through the explicit bound command allowlist and rechecks revocation before settlement", async () => {
    const task = await liveTask();
    const selected = { ...hostInput(task.binding), taskControlCommands: [writeRoot] };
    const host = await openHost(selected);
    const omitted = await openHost(hostInput(task.binding));
    const before = await inventory(), count = callbacks;
    // SAFETY: the intentional opposite-subject call proves runtime admission,
    // independently of the public TypeScript distinction.
    expect(await runEffectFailure(host.runControlChild(task.subject as never, 1n, writeRoot, row("ordinary-control"))))
      .toMatchObject({ reason: "invalidAuthority" });
    for (const taskControlCommands of [[], [writeRoot, writeRoot]]) {
      expect(await runEffectFailure(makeAtomicCommerceHost({ ...selected, taskControlCommands })))
        .toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...selected,
      taskControlCommands: [defineAtomicCommerceCommand("foreignCleanup", () => Effect.succeed(null))] })))
      .toMatchObject({ reason: "invalidAuthority" });
    await runEffect(task.lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: task.identity.runId,
      decide: value => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: task.identity.runId,
        reason: { code: "requested", message: null } }, value) }));
    const control = await runEffect(task.issueControl());
    expect(await runEffectFailure(host.runTaskChild(control as never, 1n, writeRoot, row("control-ordinary"))))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await runEffectFailure(omitted.runControlChild(control, 1n, writeRoot, row("unlisted"))))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await runEffectFailure(host.runControlChild(control, 1n, otherRoot, row("unlisted"))))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(callbacks).toBe(count); expect(await inventory()).toEqual(before);
    const result = await runEffect(host.runControlChild(control, 1n, writeRoot, row("cleanup")));
    const committed = await inventory();
    expect(committed.commerce.rows).toContainEqual(expect.objectContaining(row("cleanup")));
    const fresh = await openHost(selected);
    expect(await runEffect(fresh.runControlChild(control, 1n, writeRoot, row("cleanup")))).toEqual(result);
    expect(await inventory()).toEqual(committed); expect(callbacks).toBe(count + 1);
    const revokedRoot = defineAtomicCommerceCommand("revokeControlCleanup", Effect.fn(function* (ctx, input) {
      yield* ctx.call(participant, write, input);
      yield* ctx.emit(event, input);
      revokeTrustedWorkflowExecutionSubject(control);
      return null;
    }));
    const revokedHost = await openHost({ ...hostInput(task.binding, [revokedRoot]), taskControlCommands: [revokedRoot] });
    expect(await runEffectFailure(revokedHost.runControlChild(control, 2n, revokedRoot, row("revoked-cleanup"))))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await inventory()).toEqual(committed);
  }, 480_000);

  it("commits one child receipt and recovers the same occurrence across host reconstruction and a genuine new Task attempt", async () => {
    const task = await liveTask();
    const host = await openHost(hostInput(task.binding));
    const before = await inventory(), count = callbacks;
    const result = await runEffect(host.runTaskChild(task.subject, 1n, writeRoot, row("retained")));
    const committed = await inventory();
    expect(callbacks).toBe(count + 1);
    expect(committed.commerce.rows).toContainEqual(expect.objectContaining(row("retained")));
    expect(committed.commerce.facts.length - before.commerce.facts.length).toBe(1);
    expect(committed.commerce.outcomes.length - before.commerce.outcomes.length).toBe(1);
    expect(committed.events.length - before.events.length).toBe(1);
    expect(committed.effects.length - before.effects.length).toBe(1);
    const receipt = committed.effects.find(item => !before.effects.some(old => old.stableEffectKey === item.stableEffectKey));
    if (receipt === undefined) throw new Error("Missing child effect receipt");
    expect(receipt).toMatchObject({ state: "confirmed", effectOrdinal: 1n, childCommerceCommandName: "taskWriteRoot" });
    expect(receipt.childCommerceRequestKey).toBe(receipt.stableEffectKey);
    expect(receipt.childCommerceOutcomeSha256).toEqual(committed.commerce.outcomes.find(item => item.requestKey === receipt.stableEffectKey)?.resultSha256);
    const restarted = await openHost(hostInput(task.binding));
    const freshSubject = await runEffect(task.issue(task.identity));
    expect(await runEffect(restarted.runTaskChild(freshSubject, 1n, writeRoot, row("retained")))).toEqual(result);
    expect(await inventory()).toEqual(committed);
    expect(await runEffectFailure(restarted.runTaskChild(freshSubject, 1n, writeRoot, row("different")))).toMatchObject({ reason: "requestConflict" });
    expect(await runEffectFailure(restarted.runTaskChild(freshSubject, 1n, otherRoot, row("retained")))).toMatchObject({ reason: "requestConflict" });
    const changedPolicy = await openHost({ ...hostInput(task.binding), identityAndAccessPolicy: { profile: "changed" } });
    expect(await runEffectFailure(changedPolicy.runTaskChild(freshSubject, 1n, writeRoot, row("retained")))).toMatchObject({ reason: "requestConflict" });
    expect(await runEffectFailure(restarted.run(receipt.stableEffectKey, writeRoot, row("retained")))).toMatchObject({ reason: "invalidInput" });
    expect(callbacks).toBe(count + 1);
    const failed = await runEffect(task.lifecycle.transactRunAttempt({ operation: "complete_attempt", runId: task.identity.runId,
      decide: value => decideTrustedWorkflowCompleteAttempt({ type: "complete_attempt", ...task.identity,
        completion: { kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
          retry: { kind: "override_delay", delayMs: Result.getOrThrow(decodeTaskDurationMsV1(1)) }, executionDurationMs: null } }, value) }));
    expect(failed.outcome.kind).toBe("retry_scheduled");
    await new Promise(resolve => setTimeout(resolve, 10));
    const nextIdentity = await task.grant();
    expect(nextIdentity.attemptNumber).toBe(task.identity.attemptNumber + 1);
    const nextSubject = await runEffect(task.issue(nextIdentity));
    expect(await runEffect(restarted.runTaskChild(nextSubject, 1n, writeRoot, row("retained")))).toEqual(result);
    expect(await inventory()).toEqual(committed);
    expect(callbacks).toBe(count + 1);
    expect(await runEffectFailure(host.runTaskChild(task.subject, 2n, writeRoot, row("stale")))).toMatchObject({ reason: "invalidAuthority" });
  }, 480_000);

  it("rejects forged, expired, cancelled and insufficient-budget subjects before callbacks", async () => {
    const task = await liveTask(), host = await openHost(hostInput(task.binding)), count = callbacks;
    const before = await inventory();
    // SAFETY: deliberate structural forgery at the opaque capability boundary.
    const forged = {} as TrustedWorkflowExecutionSubject;
    expect(await runEffectFailure(host.runTaskChild(forged, 1n, writeRoot, row("forged")))).toMatchObject({ reason: "invalidAuthority" });
    for (const occurrence of [0n, 17n]) {
      expect(await runEffectFailure(host.runTaskChild(task.subject, occurrence, writeRoot, row("out-of-bounds")))).toMatchObject({ reason: "invalidInput" });
    }
    // SAFETY: deliberate binding capability forgery at host construction.
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...hostInput(task.binding), taskBinding: {} as TrustedWorkflowTaskBinding })))
      .toMatchObject({ reason: "invalidAuthority" });
    const expired = await liveTask(500);
    const expiredHost = await openHost(hostInput(expired.binding));
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(await runEffectFailure(expiredHost.runTaskChild(expired.subject, 1n, writeRoot, row("expired")))).toMatchObject({ reason: "invalidAuthority" });
    const cancelled = await liveTask();
    await runEffect(cancelled.lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: cancelled.identity.runId,
      decide: value => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: cancelled.identity.runId,
        reason: { code: "requested", message: null } }, value) }));
    expect(await runEffectFailure(host.runTaskChild(cancelled.subject, 1n, writeRoot, row("cancelled")))).toMatchObject({ reason: "invalidAuthority" });
    const short = await liveTask(5_000);
    const shortHost = await openHost(hostInput(short.binding));
    expect(await runEffectFailure(shortHost.runTaskChild(short.subject, 1n, writeRoot, row("short")))).toMatchObject({ reason: "deadlineExceeded" });
    const unbound = await openHost(hostInput());
    expect(await runEffectFailure(unbound.runTaskChild(task.subject, 1n, writeRoot, row("unbound")))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(shortHost.runTaskChild(task.subject, 1n, writeRoot, row("foreign-binding")))).toMatchObject({ reason: "invalidAuthority" });
    expect(callbacks).toBe(count);
    expect(await inventory()).toEqual(before);
  }, 480_000);

  it("rolls back real writes, facts, outcomes, events and effect preparation after caught refusal or final subject revocation", async () => {
    const task = await liveTask();
    const caught = defineAtomicCommerceCommand("taskCaughtRefusal", Effect.fn(function* (ctx, input) {
      callbacks++;
      yield* ctx.call(participant, write, input);
      yield* ctx.refuse(commerceError("invalidInput")).pipe(Effect.catch(() => Effect.succeed(null)));
      return null;
    }));
    const revoked = defineAtomicCommerceCommand("taskRevokeAfterWrite", Effect.fn(function* (ctx, input) {
      callbacks++;
      const rows = yield* ctx.call(participant, write, input);
      yield* ctx.emit(event, input);
      revokeTrustedWorkflowExecutionSubject(task.subject);
      return rows;
    }));
    const host = await openHost(hostInput(task.binding, [caught, revoked]));
    const before = await inventory();
    expect(await runEffectFailure(host.runTaskChild(task.subject, 1n, caught, row("caught")))).toMatchObject({ reason: "rollbackOnly" });
    expect(await inventory()).toEqual(before);
    expect(await runEffectFailure(host.runTaskChild(task.subject, 2n, revoked, row("revoked")))).toMatchObject({ reason: "invalidAuthority" });
    expect(await inventory()).toEqual(before);
  }, 480_000);

  it("rolls back the prepared effect and actual write when the existing command deadline expires", async () => {
    const task = await liveTask();
    let writesCompleted = 0;
    const waits = defineAtomicCommerceCommand("taskDeadlineAfterWrite", Effect.fn(function* (ctx, input) {
      yield* ctx.call(participant, write, input);
      yield* ctx.emit(event, input);
      writesCompleted++;
      yield* Effect.sleep(10_100);
      return null;
    }));
    const host = await openHost(hostInput(task.binding, [waits]));
    const before = await inventory();
    expect(await runEffectFailure(host.runTaskChild(task.subject, 1n, waits, row("deadline")))).toMatchObject({ reason: "deadlineExceeded" });
    expect(writesCompleted).toBe(1);
    expect(await inventory()).toEqual(before);
  }, 480_000);

  it("gates actual child events on parent and Notification release, binds eligibility to request identity and clears without undoing commerce", async () => {
    const task = await liveTask(), host = await openHost(hostInput(task.binding));
    const input = fixture.hostInput;
    const eligibility = await runEffect(makeCommitEventEligibilityStore(input));
    const group = (groupId: string) => eligibility.open({ groupId, ownerIdentity: "d".repeat(64), policyRevision: "e".repeat(64), maximumCommits: 4 });
    const parent = await runEffect(group("task-parent")), notification = await runEffect(group("task-notification"));
    const both = Result.getOrThrow(prepareCommitEventEligibility([parent, notification]));
    const onlyParent = Result.getOrThrow(prepareCommitEventEligibility([parent]));
    await runEffect(host.runTaskChild(task.subject, 1n, writeRoot, row("held"), both));
    const held = (await events()).find(item => item.envelope.message !== null && typeof item.envelope.message === "object" &&
      !Array.isArray(item.envelope.message) && "id" in item.envelope.message && item.envelope.message.id === "held");
    if (held === undefined) throw new Error("Missing real child event");
    const members = await input.database.select().from(fxSystemCommitEventEligibilityMembers).where(eq(fxSystemCommitEventEligibilityMembers.commitSeq, held.commitSeq));
    expect(members.map(item => item.groupId).sort()).toEqual(["task-notification", "task-parent"]);
    expect(await runEffectFailure(host.runTaskChild(task.subject, 1n, writeRoot, row("held"), onlyParent))).toMatchObject({ reason: "requestConflict" });
    expect(await runEffectFailure(host.runTaskChild(task.subject, 1n, writeRoot, row("held")))).toMatchObject({ reason: "requestConflict" });
    const delivered: Json[] = [];
    const pump = await runEffect(makeCommitEventPump(input, [{ ...subscriber, handle: message => Effect.sync(() => { delivered.push(message.envelope.message); }) }]));
    const store = await runEffect(makeCommitEventStore(input));
    expect(await runEffect(store.claimBatch(held.commitSeq, [subscriber], 8))).toEqual([]);
    await runEffect(eligibility.decide(notification, "released"));
    expect(await runEffect(store.claimBatch(held.commitSeq, [subscriber], 8))).toEqual([]);
    expect(await runEffect(pump.runNext(held.commitSeq - 1n))).toMatchObject({ cursor: held.commitSeq, delivered: 0 });
    await runEffect(eligibility.decide(parent, "released"));
    expect(await runEffect(pump.runNext(held.commitSeq - 1n))).toMatchObject({ cursor: held.commitSeq, delivered: 1 });
    expect(delivered).toEqual([row("held")]);
    const cleared = await runEffect(group("task-cleared"));
    const clearPreparation = Result.getOrThrow(prepareCommitEventEligibility([cleared]));
    await runEffect(host.runTaskChild(task.subject, 2n, writeRoot, row("cleared"), clearPreparation));
    const after = await inventory();
    const last = after.events.at(-1);
    if (last === undefined) throw new Error("Missing clearing child event");
    await runEffect(eligibility.decide(cleared, "cleared"));
    expect(await runEffect(store.claimBatch(last.commitSeq, [subscriber], 8))).toEqual([]);
    expect(await inventory()).toEqual(after);
    expect(after.commerce.rows).toContainEqual(expect.objectContaining(row("cleared")));
  }, 480_000);
});
