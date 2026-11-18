import { eq } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Scope, Tracer } from "effect";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSeqSchema, projectScopeEpochUuidV1, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { expect } from "vitest";

import { createApplicationQueryCacheHandoff, type ApplicationQueryCacheRequest } from "../../../src/application/applicationQueryDataCache";
import { withApplicationQueryCompletion } from "../../../src/application/applicationQueryCompletion";
import { ApplicationQuerySnapshotError, completeApplicationQuerySnapshot, openApplicationQuerySnapshot as openQuerySnapshot, readApplicationQueryIndex, readApplicationQueryPoint } from "../../../src/application/applicationQuerySnapshot";
import { fxSystemCommitAppRowChanges, fxSystemCommits, fxSystemScopeClocks } from "../../../src/database/schema";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../../src/execution/diagnostics/operation";
import { liveScopeExecution, ScopeExecution, type ScopeExecutionApi } from "../../../src/scope/execution/ScopeExecution";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../src/scope/scopeClock";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../../../src/storage/documents/appRows";
import { withApplicationNativeFixtureTransaction, type ApplicationNativeMutationFixture, type ApplicationNativeMutationPersistence } from "../applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { openApplicationQuerySnapshot, queryBudget } from "./support/querySnapshot";

export const HANDOFF_ROW_ID = decodeAppRowIdHexV1("11".repeat(16));
export const QUERY_CACHE_HANDOFF_FIXTURE_OPTIONS = Object.freeze({
  runtimeHostIdentity: "flarex.test/query-cache-handoff-lifecycle",
  compatibilityDate: "2026-06-14",
  includeUserNameIndex: true,
  initialUserDocuments: Object.freeze([{ name: "Ada", rowId: HANDOFF_ROW_ID }]),
});

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;

/** These are real snapshot/Scope transitions. The fixture's canonical initial
 * rows supply structural history; producer completeness is proved separately. */
export async function assertQueryCacheHandoffLifecycle(fixture: Fixture): Promise<void> {
  const table = fixture.schemaAuthority.tables.find(candidate => candidate.logicalName === "users");
  if (table === undefined) throw new Error("Lifecycle fixture users table missing");
  const clock = await fixture.target.getScopeClock(fixture.active.basis.authority.scopeId);
  if (clock === null) throw new Error("Lifecycle fixture clock missing");
  const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId: HANDOFF_ROW_ID });
  const budget = queryBudget();
  const request: ApplicationQueryCacheRequest = Object.freeze({
    stamp: Object.freeze({ deploymentId: fixture.deploymentId, scopeId: clock.scopeId,
      storageGeneration: clock.storageGeneration, storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch, commitSeq: clock.lastCommitSeq }),
    budget,
    // Probing consumes and discards the idle data; it does not issue an index read.
    definitions: Object.freeze([]),
    tableIds: Object.freeze(fixture.schemaAuthority.tables.map(candidate => candidate.tableId)),
  });
  for (const mode of ["unsealed", "success", "failure", "interrupt", "ownedSuccess", "cleanupFailure"] as const) {
    const handoff = createApplicationQueryCacheHandoff();
    const cleanupDefect = new Error("cleanup after snapshot release failed");
    try {
      const body = Effect.gen(function* () {
        // Register first: Snapshot release stages data before this older
        // finalizer fails, so post-scope outcome must still discard it.
        if (mode === "cleanupFailure") yield* Effect.addFinalizer(() => Effect.die(cleanupDefect));
        const opened = yield* openApplicationQuerySnapshot(fixture.active.selection, "users:get", budget, {
          deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts, schema: fixture.schema,
          developerIndexes: fixture.developerIndexes, cacheHandoff: handoff,
        });
        const point = yield* readApplicationQueryPoint(opened.snapshot, "users", documentId);
        expect(point).toMatchObject({ kind: "present", document: { name: "Ada" } });
        if (mode !== "unsealed") {
          yield* completeApplicationQuerySnapshot(opened.snapshot);
          const late = yield* Effect.result(readApplicationQueryPoint(opened.snapshot, "users", documentId));
          expect(late._tag).toBe("Failure");
          if (late._tag === "Failure") expect(late.failure).toMatchObject({ operation: "pointRead", reason: "invalidComposition" });
          const repeated = yield* Effect.result(completeApplicationQuerySnapshot(opened.snapshot));
          expect(repeated._tag).toBe("Failure");
        }
        if (mode === "failure") return yield* Effect.fail("failure after completion" as const);
        if (mode === "interrupt") return yield* Effect.interrupt;
      });
      const outcome = await runEffect(Effect.exit(mode === "ownedSuccess" || mode === "cleanupFailure"
        ? withApplicationQueryCompletion(body) : Effect.scoped(body)));
      if (mode === "failure") {
        expect(Exit.isFailure(outcome)).toBe(true);
        if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.some(reason =>
          Cause.isFailReason(reason) && reason.error === "failure after completion")).toBe(true);
      } else if (mode === "interrupt") {
        expect(Exit.isFailure(outcome) && Cause.hasInterruptsOnly(outcome.cause)).toBe(true);
      } else if (mode === "cleanupFailure") {
        expect(Exit.isFailure(outcome)).toBe(true);
        if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect))
          .toEqual([cleanupDefect]);
      } else expect(Exit.isSuccess(outcome)).toBe(true);
      const idle = handoff.take(request);
      expect(Option.isSome(idle), `${mode} scope cache return`).toBe(mode === "success" || mode === "ownedSuccess");
    } finally { handoff.dispose(); }
  }
  await assertOverlappingSnapshotOwnership(fixture);
  await assertInterruptedRefreshDiscardsCheckout(fixture);
  await assertQueuedLateReadIsRefused(fixture);
}

function context(fixture: Fixture, handoff: ReturnType<typeof createApplicationQueryCacheHandoff>) {
  return Object.freeze({ deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts, schema: fixture.schema,
    developerIndexes: fixture.developerIndexes, cacheHandoff: handoff });
}

function rowIdentity(fixture: Fixture) {
  const table = fixture.schemaAuthority.tables.find(candidate => candidate.logicalName === "users");
  if (table === undefined) throw new Error("Lifecycle fixture users table missing");
  return { tableId: table.tableId, rowId: HANDOFF_ROW_ID };
}

async function probeRequest(fixture: Fixture): Promise<ApplicationQueryCacheRequest> {
  const clock = await fixture.target.getScopeClock(fixture.active.basis.authority.scopeId);
  if (clock === null) throw new Error("Lifecycle fixture clock missing");
  return Object.freeze({ stamp: Object.freeze({ deploymentId: fixture.deploymentId,
    scopeId: clock.scopeId, storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch, commitSeq: clock.lastCommitSeq }),
    budget: queryBudget(), definitions: Object.freeze([]),
    tableIds: Object.freeze(fixture.schemaAuthority.tables.map(table => table.tableId)) });
}

/** A canonical structural history transition, not a business publisher model.
 * Padding changes neither declared index key. Keep the existing matching active
 * maintenance opening intact: its continuous-maintenance contract covers this
 * unchanged membership; it must not be given a fabricated newer frontier.
 * Production publisher completeness remains the genuine consumer's proof. */
async function appendStructuralBodyRevision(fixture: Fixture, padding: string) {
  const identity = rowIdentity(fixture);
  const document = await canonicalizeAppDocumentV1({ ...identity,
    creationTime: decodeAppCreationTimeV1(1), fields: { name: "Ada", padding } });
  await withApplicationNativeFixtureTransaction(fixture.target, async tx => {
    const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, fixture.active.basis.authority.scopeId));
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    const scopeUuid = projectScopeIdUuidV1(clock.scopeId).scopeUuid;
    const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live", scopeId: clock.scopeId, ...identity, writeEpoch: clock.epoch,
      commitSeq, prevCommitSeq: clock.lastCommitSeq, schemaVersionId: fixture.schemaAuthority.schemaVersionId,
      creationTime: decodeAppCreationTimeV1(1), value: { codecVersion: document.codecVersion,
        valueJson: document.valueJson, canonicalBytes: document.canonicalBytes, sha256: document.sha256 },
    });
    await tx.insert(fxSystemCommits).values({ scopeUuid, epochUuid, commitSeq, changeCount: 1 });
    await tx.insert(fxSystemCommitAppRowChanges).values({ scopeUuid, epochUuid, commitSeq, changeOrdinal: 0,
      tableId: identity.tableId, rowId: appRowIdHexV1ToBytes(identity.rowId) });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(eq(fxSystemScopeClocks.scopeId, clock.scopeId));
  });
}

function observeDataReads() {
  const counts = { rows: 0, indexes: 0, refreshes: 0 };
  const tracer = Tracer.make({ span(options) {
    if (options.name === "AppRows.captureSnapshotRead") counts.rows++;
    if (options.name === "ApplicationQueryCache.captureRefresh") counts.refreshes++;
    return new Tracer.NativeSpan(options);
  } });
  const diagnostics: ExecutionDiagnosticPolicy = { observe(name, work) {
    if (name === "AppIndexEntries.scanAtSnapshotInTransaction") counts.indexes++;
    return work;
  } };
  return { counts, tracer, diagnostics };
}

async function assertOverlappingSnapshotOwnership(fixture: Fixture) {
  const handoff = createApplicationQueryCacheHandoff();
  const view = context(fixture, handoff), budget = queryBudget();
  const documentId = appDocumentIdV1FromRowIdentity(rowIdentity(fixture));
  const oldScope = await runEffect(Scope.make());
  let oldClosed = false;
  const readView = Effect.gen(function* () {
    const opened = yield* openApplicationQuerySnapshot(fixture.active.selection, "users:get", budget, view);
    const point = yield* readApplicationQueryPoint(opened.snapshot, "users", documentId);
    const page = yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
    yield* completeApplicationQuerySnapshot(opened.snapshot);
    return { point, page, stamp: opened.metadata.snapshotToken.commitSeq };
  });
  try {
    const warm = await runEffect(Effect.scoped(readView));
    const old = await runEffect(openApplicationQuerySnapshot(fixture.active.selection, "users:get", budget, view).pipe(Scope.provide(oldScope)));
    const oldBefore = await runEffect(readApplicationQueryPoint(old.snapshot, "users", documentId));
    await appendStructuralBodyRevision(fixture, "overlap-new");
    const newReads = observeDataReads();
    const newer = await runEffect(Effect.scoped(readView).pipe(Effect.withTracer(newReads.tracer),
      Effect.provideService(ExecutionDiagnostics, newReads.diagnostics)));
    expect(newer.stamp).toBe(warm.stamp + 1n);
    expect(newer.point).toMatchObject({ kind: "present", document: { padding: "overlap-new" } });
    expect(newReads.counts.rows).toBeGreaterThan(0);
    expect(newReads.counts.indexes).toBeGreaterThan(0);
    const oldAfter = await runEffect(readApplicationQueryPoint(old.snapshot, "users", documentId));
    const oldRange = await runEffect(readApplicationQueryIndex(old.snapshot, "users", "by_name", {}, 10));
    expect(oldAfter).toEqual(oldBefore);
    expect(oldRange).toEqual(warm.page);
    await runEffect(completeApplicationQuerySnapshot(old.snapshot));
    await runEffect(Scope.close(oldScope, Exit.succeed(undefined)));
    oldClosed = true;
    const retainedReads = observeDataReads();
    const retained = await runEffect(Effect.scoped(readView).pipe(Effect.withTracer(retainedReads.tracer),
      Effect.provideService(ExecutionDiagnostics, retainedReads.diagnostics)));
    expect(retained).toEqual(newer);
    // A late old return must not replace the newer idle cache and force replay.
    // The cold newer operation above proves these observations are connected.
    expect(retainedReads.counts).toEqual({ rows: 0, indexes: 0, refreshes: 0 });
  } finally {
    if (!oldClosed) await runEffect(Scope.close(oldScope, Exit.interrupt(0)));
    handoff.dispose();
  }
}

async function assertInterruptedRefreshDiscardsCheckout(fixture: Fixture) {
  const handoff = createApplicationQueryCacheHandoff();
  const view = context(fixture, handoff), budget = queryBudget();
  const documentId = appDocumentIdV1FromRowIdentity(rowIdentity(fixture));
  const readView = Effect.gen(function* () {
    const opened = yield* openApplicationQuerySnapshot(fixture.active.selection, "users:get", budget, view);
    const point = yield* readApplicationQueryPoint(opened.snapshot, "users", documentId);
    yield* completeApplicationQuerySnapshot(opened.snapshot);
    return point;
  });
  try {
    await runEffect(Effect.scoped(readView));
    await appendStructuralBodyRevision(fixture, "after-cancel");
    let interrupt: (() => void) | undefined;
    const refreshes: Tracer.NativeSpan[] = [];
    const bodies: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({ span(options) {
      const span = new Tracer.NativeSpan(options);
      if (options.name === "ApplicationQueryCache.captureRefresh") {
        refreshes.push(span);
        interrupt?.();
      }
      if (options.name === "AppRows.captureSnapshotRead") bodies.push(span);
      return span;
    } });
    const pending = Effect.runFork(Effect.withFiber(fiber => {
      // This installed synchronous diagnostic callback cannot run an Effect;
      // request interruption of the actual outer operation, not its DB callback.
      interrupt = () => fiber.interruptUnsafe();
      return Effect.scoped(readView).pipe(Effect.withTracer(tracer));
    }));
    let cancelled;
    try { cancelled = await runEffect(Fiber.await(pending)); }
    finally { await runEffect(Fiber.interrupt(pending)); }
    expect(refreshes).toHaveLength(1);
    expect(Exit.isFailure(cancelled) && Cause.hasInterruptsOnly(cancelled.cause)).toBe(true);
    for (const span of refreshes) {
      expect(span.status._tag).toBe("Ended");
      if (span.status._tag === "Ended") expect(Exit.isSuccess(span.status.exit)).toBe(true);
    }
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every(span => span.status._tag === "Ended")).toBe(true);
    expect(Option.isNone(handoff.take(await probeRequest(fixture)))).toBe(true);
    const coldReads = observeDataReads();
    const after = await runEffect(Effect.scoped(readView).pipe(Effect.withTracer(coldReads.tracer),
      Effect.provideService(ExecutionDiagnostics, coldReads.diagnostics)));
    expect(after).toMatchObject({ kind: "present", document: { padding: "after-cancel" } });
    expect(coldReads.counts.rows).toBeGreaterThan(0);
    expect(coldReads.counts.refreshes).toBe(0);
  } finally { handoff.dispose(); }
}

async function assertQueuedLateReadIsRefused(fixture: Fixture) {
  const handoff = createApplicationQueryCacheHandoff();
  const view = context(fixture, handoff), budget = queryBudget();
  const request = await probeRequest(fixture);
  const documentId = appDocumentIdV1FromRowIdentity(rowIdentity(fixture));
  const entered = await runEffect(Deferred.make<void>());
  const release = await runEffect(Deferred.make<void>());
  const completing = await runEffect(Deferred.make<void>());
  let pauseNext = false;
  const scoped: ScopeExecutionApi = {
    runRead(located, settlement, operation, input) {
      const work = liveScopeExecution.runRead(located, settlement, operation, input);
      if (!pauseNext) return work;
      pauseNext = false;
      // The logical snapshot has already acquired readGate. The real execution
      // owner still performs every authority/clock/SQL action after this latch.
      return Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return yield* work;
      });
    },
    runWrite: liveScopeExecution.runWrite,
  };
  const reads = observeDataReads();
  try {
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openQuerySnapshot(fixture.active.selection, "users:get", budget, view)
        .pipe(Effect.provideService(ScopeExecution, scoped));
      pauseNext = true;
      const first = yield* Effect.forkChild(readApplicationQueryPoint(opened.snapshot, "users", documentId));
      yield* Deferred.await(entered);
      const completion = yield* Effect.forkChild(Effect.gen(function* () {
        yield* Deferred.succeed(completing, undefined);
        yield* completeApplicationQuerySnapshot(opened.snapshot);
      }));
      yield* Deferred.await(completing);
      // Yield the scheduler, not wall-clock time, so completion queues first.
      yield* Effect.yieldNow;
      const late = yield* Effect.forkChild(Effect.exit(readApplicationQueryPoint(opened.snapshot, "users", documentId)));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toMatchObject({ kind: "present" });
      yield* Fiber.join(completion);
      const refused = yield* Fiber.join(late);
      expect(Exit.isFailure(refused)).toBe(true);
      if (Exit.isFailure(refused)) expect(refused.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error instanceof ApplicationQuerySnapshotError && reason.error.operation === "pointRead" &&
        reason.error.reason === "invalidComposition")).toBe(true);
      expect(reads.counts.rows).toBe(1);
      // Completion seals ownership; it is not yet available while Scope lives.
      expect(Option.isNone(handoff.take(request))).toBe(true);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("15 seconds")))
      .pipe(Effect.withTracer(reads.tracer), Effect.provideService(ExecutionDiagnostics, reads.diagnostics)));
    expect(Option.isSome(handoff.take(request))).toBe(true);
  } finally {
    await runEffect(Deferred.succeed(release, undefined));
    handoff.dispose();
  }
}
