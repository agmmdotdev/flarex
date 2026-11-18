import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Clock, Effect, Exit, Result } from "effect";
import { InMemoryLockingProvider } from "@medusajs/locking/providers/in-memory";
import { LockingModuleService } from "@medusajs/locking/services";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeTaskExecutionPrincipalReferenceV1, makeTaskInputReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decideTrustedWorkflowStartAttempt, decideTrustedWorkflowHeartbeatAttempt, decideTrustedWorkflowRequestCancellation,
  decodeTaskRetryJitterV1, decodeTaskHeartbeatSequenceV1, decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../persistence-postgres/src/application/deployments";
import { createPGlitePersistence, createPGliteDeadlineOwnedTaskRunAttemptTarget } from "../../persistence-postgres/src/database/pglite";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../persistence-postgres/src/tasks/postgresTaskExternalEffectAuthority";
import { makeTrustedWorkflowTaskRunCreationStore } from "../../persistence-postgres/src/tasks/trustedWorkflowTaskRunCreation";
import { makeTrustedWorkflowTaskSystemRunAttemptStore, type LocatedTaskSystemRunAttemptTargetV1 } from "../../persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1";
import { issueTrustedWorkflowExecutionSubject, issueTrustedWorkflowControlSubject, revokeTrustedWorkflowExecutionSubject } from "../../persistence-postgres/src/tasks/trustedWorkflowExecutionSubject";
import type { DeadlineOwnedTaskPersistenceTarget } from "../../persistence-postgres/src/tasks/taskPersistenceTransaction";
import { fxSystemExternalEffectAttemptsV1 } from "../../persistence-postgres/src/database/schema";
import { insertCurrentScopeClockFixture } from "../../persistence-postgres/test/scope/scopeClockFixture";
import { newTestPGlite } from "../../persistence-postgres/test/support/pgliteSearchExtensions";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/support/postgresHelpers";
import { locatedTaskAuthorityV1, readyTaskRunAggregateV1, TASK_LOCATOR } from "../../persistence-postgres/test/tasks/taskSystemRunAttemptStoreTestSupport";
import { makeFulfillmentDeliveryLocking, fulfillmentDeliveryLockingPolicy } from "../src/workflow/durable-locking";
import type { DurableNativeEffectBoundary } from "../src/workflow/durable-native-storage";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite", cleanup: Array<() => Promise<void>> = [];
const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
  statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
let db: FlarexMetadataDatabase, target: LocatedTaskSystemRunAttemptTargetV1 & DeadlineOwnedTaskPersistenceTarget;
class BoundaryFailure {
  constructor(readonly cause: Cause.Cause<unknown>) {}
}
const boundary: DurableNativeEffectBoundary = async work => {
  const exit = await Effect.runPromiseExit(work);
  if (Exit.isFailure(exit)) throw new BoundaryFailure(exit.cause);
  return exit.value;
};

beforeAll(async () => {
  if (driver === "postgres") {
    const fixture = await createFileScopedPostgresFixture(); cleanup.push(fixture.dispose); db = fixture.persistence.drizzle;
    const resource = Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
      connectionString: fixture.persistence.pool.options.connectionString, options: fixture.persistence.pool.options.options, max: 2,
    }, TASK_LOCATOR, deadlines));
    cleanup.push(resource.close); target = resource.lifecycleTarget;
  } else {
    if (driver !== "pglite") throw new Error("Unsupported native Locking test driver");
    const raw = newTestPGlite(); cleanup.push(() => raw.close());
    const persistence = await createPGlitePersistence({ db: raw }); await persistence.migrate(); db = persistence.drizzle;
    target = Result.getOrThrow(createPGliteDeadlineOwnedTaskRunAttemptTarget(persistence, TASK_LOCATOR, deadlines));
  }
}, 480_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 480_000);

/** Actual creation, grant, heartbeat, cancellation and subject issuers. The
 * fixture supplies no Task state machine, journal model or lock arbitration. */
async function scenario() {
  const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`);
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: `epoch_${randomUUID()}` });
  const located = await locatedTaskAuthorityV1(db, target, scopeId, `native-locking-${randomUUID()}`);
  const canonical = await Effect.runPromise(canonicalizeFlarexValueV1Effect({ version: 1, scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|locking", subject: "locking", issuer: "issuer" } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  const binding = await Effect.runPromise(prepareTrustedWorkflowTaskBinding({ scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: "native-delivery-locking-test",
    executionPolicy: fulfillmentDeliveryLockingPolicy, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: { ...readyTaskRunAggregateV1().boundPolicy, leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(120_000)) } }, hash));
  const options = { authority: located.authority, target, binding, principal, principalCanonicalBytes: canonical.canonicalBytes, sha256: hash },
    creation = makeTrustedWorkflowTaskRunCreationStore(options), lifecycle = makeTrustedWorkflowTaskSystemRunAttemptStore(located);
  const create = async () => {
    const created = await Effect.runPromise(creation.createRun({ requestKey: randomUUID(), principal,
      input: Result.getOrThrow(makeTaskInputReferenceV1(new Uint8Array(32).fill(0x45), 1)) }));
    const current = await Effect.runPromise(lifecycle.inspectRunAttempt({ operation: "inspect_current_attempt", runId: created.runId }));
    const started = await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "start_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowStartAttempt({ type: "start_attempt", runId: created.runId,
        expectedRunVersion: current.current.runVersion, retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.25)) }, value) }));
    if (started.outcome.kind !== "attempt_granted") throw new Error("Missing actual Locking Task grant");
    const identity = { runId: created.runId, ...started.outcome.grant.attempt };
    await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "heartbeat_attempt", runId: created.runId,
      decide: value => decideTrustedWorkflowHeartbeatAttempt({ type: "heartbeat_attempt", ...identity,
        heartbeatSequence: Result.getOrThrow(decodeTaskHeartbeatSequenceV1(1)) }, value) }));
    const issue = async () => {
      const subject = await Effect.runPromise(issueTrustedWorkflowExecutionSubject(identity, options));
      cleanup.push(async () => { revokeTrustedWorkflowExecutionSubject(subject); }); return subject;
    };
    const subject = await issue(), ownerId = `fulfillment-delivery:${created.runId}`;
    const control = async () => {
      await Effect.runPromise(lifecycle.transactRunAttempt({ operation: "request_cancellation", runId: created.runId,
        decide: value => decideTrustedWorkflowRequestCancellation({ type: "request_cancellation", runId: created.runId,
          reason: { code: "requested", message: null } }, value) }));
      const subject = await Effect.runPromise(issueTrustedWorkflowControlSubject(identity, options));
      cleanup.push(async () => { revokeTrustedWorkflowExecutionSubject(subject); }); return subject;
    };
    return { subject, ownerId, issue, control };
  };
  const prepare = async (clock?: Clock.Clock) => {
    const work = makeFulfillmentDeliveryLocking({ task: options, revision: "c".repeat(64) });
    const helper = await Effect.runPromise(clock === undefined ? work : work.pipe(Effect.provideService(Clock.Clock, clock)));
    cleanup.push(() => Effect.runPromise(helper.close)); return helper;
  };
  const receipts = async () => (await db.select().from(fxSystemExternalEffectAttemptsV1)).filter(row => row.scopeId === scopeId && row.effectKind === "trusted_callback");
  return { create, prepare, receipts };
}

describe(`native Delivery in-memory Locking callback profile - ${driver}`, { concurrent: false }, () => {
  it("journals actual native acquire and both releases with their stable bounded ordinals", async () => {
    const s = await scenario(), helper = await s.prepare(), task = await s.create(), id = "ful145-journal", service = helper.serviceFor({ subject: task.subject, id, boundary });
    const acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire"), release = vi.spyOn(LockingModuleService.prototype, "release");
    try {
      await service.acquire(id, { expire: 10, ownerId: task.ownerId, provider: undefined });
      await Effect.runPromise(helper.assertAcquisitionObservation(task.subject, id));
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(await service.release([id], { ownerId: task.ownerId, provider: undefined })).toBe(true);
      expect(await service.release([id], { ownerId: task.ownerId, provider: undefined })).toBe(false);
      expect(release.mock.calls.map(args => args.slice(0, 2))).toEqual([
        [[id], { ownerId: task.ownerId }], [[id], { ownerId: task.ownerId }],
      ]);
      const receipts = await s.receipts();
      expect(receipts.map(row => row.effectOrdinal).sort((a, b) => Number(a - b))).toEqual([1n, 9n, 10n]);
      expect(receipts.every(row => row.state === "confirmed")).toBe(true);
      expect(receipts.find(row => row.effectOrdinal === 1n)?.trustedCallbackOutcomeJson).toMatchObject({ kind: "returned", value: {
        lifecycleNonce: expect.any(String), acquisitionNonce: expect.any(String),
      } });
      const absent = await Effect.runPromiseExit(helper.assertAcquisitionObservation(task.subject, id));
      expect(Exit.isFailure(absent)).toBe(true);
      await Effect.runPromise(helper.close); await Effect.runPromise(helper.close);
    } finally { acquire.mockRestore(); release.mockRestore(); }
  }, 120_000);

  it("keeps real provider contention retryable and preserves a newer owner through old control compensation", async () => {
    const s = await scenario(), helper = await s.prepare(), first = await s.create(), second = await s.create(), third = await s.create(), id = "ful145-owner";
    const a = helper.serviceFor({ subject: first.subject, id, boundary }), b = helper.serviceFor({ subject: second.subject, id, boundary }),
      c = helper.serviceFor({ subject: third.subject, id, boundary });
    await a.acquire(id, { expire: 10, ownerId: first.ownerId });
    await expect(b.acquire(id, { expire: 10, ownerId: second.ownerId })).rejects.toThrow(`Failed to acquire lock for key "${id}"`);
    expect(await a.release([id], { ownerId: first.ownerId })).toBe(true);
    await b.acquire(id, { expire: 10, ownerId: second.ownerId });
    await Effect.runPromise(helper.assertAcquisitionObservation(second.subject, id));
    const control = await first.control(), inverse = helper.serviceFor({ subject: control, id, boundary });
    expect(await inverse.release([id], { ownerId: first.ownerId })).toBe(false);
    await expect(c.acquire(id, { expire: 10, ownerId: third.ownerId })).rejects.toThrow(`Failed to acquire lock for key "${id}"`);
    expect(await b.release([id], { ownerId: second.ownerId })).toBe(true);
    await c.acquire(id, { expire: 10, ownerId: third.ownerId });
    expect(await c.release([id], { ownerId: third.ownerId })).toBe(true);
    const receipts = await s.receipts();
    expect(receipts.filter(row => isJsonObject(row.trustedCallbackOutcomeJson) && row.trustedCallbackOutcomeJson.kind === "failed")).toHaveLength(2);
    expect(receipts.filter(row => row.effectOrdinal === 10n)).toMatchObject([{ state: "confirmed", trustedCallbackOutcomeJson: {
      kind: "returned", value: { released: false },
    } }]);
  }, 120_000);

  it.each(["foreign object", "unexpected Error"])("keeps %s failure sticky without a release or second provider invocation", async kind => {
    const s = await scenario(), helper = await s.prepare(), task = await s.create(), id = "ful145-sticky", service = helper.serviceFor({ subject: task.subject, id, boundary }),
      foreign = kind === "foreign object" ? { reason: "uncertain native provider outcome" } : new Error("Unexpected provider failure");
    const acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire").mockRejectedValueOnce(foreign), release = vi.spyOn(InMemoryLockingProvider.prototype, "release");
    try {
      const failure: unknown = await service.acquire(id, { expire: 10, ownerId: task.ownerId }).catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(BoundaryFailure);
      if (!(failure instanceof BoundaryFailure)) throw new Error("Expected full owning boundary Cause");
      expect(failure.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === foreign)).toBe(true);
      const retried: unknown = await service.acquire(id, { expire: 10, ownerId: task.ownerId }).catch((cause: unknown) => cause),
        compensated: unknown = await service.release([id], { ownerId: task.ownerId }).catch((cause: unknown) => cause);
      expect(retried).toBeInstanceOf(BoundaryFailure); expect(compensated).toBeInstanceOf(BoundaryFailure);
      if (!(retried instanceof BoundaryFailure) || !(compensated instanceof BoundaryFailure)) throw new Error("Expected retained owning Cause");
      expect(retried.cause).toEqual(failure.cause); expect(compensated.cause).toEqual(failure.cause);
      expect(acquire).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled();
      expect(await s.receipts()).toMatchObject([{ effectOrdinal: 1n, state: "dispatching", trustedCallbackOutcomeJson: null }]);
    } finally { acquire.mockRestore(); release.mockRestore(); }
  }, 120_000);

  it("refuses an acquisition receipt after helper restart without calling the new native provider", async () => {
    const s = await scenario(), original = await s.prepare(), task = await s.create(), id = "ful145-restart";
    await original.serviceFor({ subject: task.subject, id, boundary }).acquire(id, { expire: 10, ownerId: task.ownerId });
    const restarted = await s.prepare(), acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire");
    try {
      const failure: unknown = await restarted.serviceFor({ subject: task.subject, id, boundary }).acquire(id, { expire: 10, ownerId: task.ownerId })
        .catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(BoundaryFailure); expect(acquire).not.toHaveBeenCalled();
      const rows = await s.receipts(); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: "confirmed", effectOrdinal: 1n });
    } finally { acquire.mockRestore(); }
  }, 120_000);

  it("replays a completed release without interpreting its old receipt as an acquisition", async () => {
    const s = await scenario(), original = await s.prepare(), task = await s.create(), id = "ful145-release-replay",
      service = original.serviceFor({ subject: task.subject, id, boundary });
    await service.acquire(id, { expire: 10, ownerId: task.ownerId });
    expect(await service.release([id], { ownerId: task.ownerId })).toBe(true);
    const restarted = await s.prepare(), release = vi.spyOn(InMemoryLockingProvider.prototype, "release");
    try {
      expect(await restarted.serviceFor({ subject: task.subject, id, boundary }).release([id], { ownerId: task.ownerId })).toBe(true);
      expect(release).not.toHaveBeenCalled();
      expect(Exit.isFailure(await Effect.runPromiseExit(restarted.assertAcquisitionObservation(task.subject, id)))).toBe(true);
    } finally { release.mockRestore(); }
  }, 120_000);

  it("expires only its conservative receipt-age admission and refuses a fresh subject for an old observation", async () => {
    const s = await scenario(), actualClock = await Effect.runPromise(Clock.Clock);
    let elapsed = 0n;
    const clock: Clock.Clock = {
      currentTimeMillisUnsafe: () => actualClock.currentTimeMillisUnsafe(), currentTimeMillis: actualClock.currentTimeMillis,
      currentTimeNanosUnsafe: () => actualClock.currentTimeNanosUnsafe(), currentTimeNanos: actualClock.currentTimeNanos,
      monotonicTimeNanosUnsafe: () => elapsed, monotonicTimeNanos: Effect.sync(() => elapsed), sleep: duration => actualClock.sleep(duration),
    };
    const helper = await s.prepare(clock), task = await s.create(), id = "ful145-observation-age";
    await helper.serviceFor({ subject: task.subject, id, boundary }).acquire(id, { expire: 10, ownerId: task.ownerId });
    elapsed = 9_999_999_999n;
    await Effect.runPromise(helper.assertAcquisitionObservation(task.subject, id));
    const fresh = await task.issue();
    expect(Exit.isFailure(await Effect.runPromiseExit(helper.assertAcquisitionObservation(fresh, id)))).toBe(true);
    elapsed = 10_000_000_000n;
    expect(Exit.isFailure(await Effect.runPromiseExit(helper.assertAcquisitionObservation(task.subject, id)))).toBe(true);
    // No native Date or expiry algorithm was replaced: this checks only the
    // profile's independent conservative observation age, never a live lease.
  }, 120_000);

  it("refuses excess native options before creating a callback effect", async () => {
    const s = await scenario(), helper = await s.prepare(), task = await s.create(), id = "ful145-options",
      service = helper.serviceFor({ subject: task.subject, id, boundary }), acquire = vi.spyOn(InMemoryLockingProvider.prototype, "acquire");
    try {
      await expect(service.acquire(id, { expire: 10, ownerId: task.ownerId, awaitQueue: true })).rejects.toBeInstanceOf(BoundaryFailure);
      expect(acquire).not.toHaveBeenCalled(); expect(await s.receipts()).toEqual([]);
    } finally { acquire.mockRestore(); }
  }, 120_000);
});
