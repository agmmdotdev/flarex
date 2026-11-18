import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { expect, vi } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import { createPointMutationAttemptReplacementPortV1 } from "../../../src/commit/point/construction";
import { PointMutationAttemptReplacementFiniteEntryError } from "../../../src/commit/point/errors";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { fxSystemTransactionSessions } from "../../../src/database/schema";
import { createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "../../../src/execution/session/terminalization";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../../src/scope/scopeClock";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import { inventory, makeFiniteIndexedQueriesHarness } from "./finiteIndexedQueriesScenario";
import { observeFiniteApplicationAdmissionDriver } from "./finiteApplicationAdmissionDriverObserver";
import * as finiteStorageCapture from "../../../src/execution/finiteStorageCapture";
import type { FiniteStorageCaptureOperation, FiniteStorageCaptureError } from "../../../src/execution/finiteStorageCapture";
import type { ExactRunningAttemptKernelInputV1 } from "../../../src/execution/session/kernelContracts";
import type { LocatedScopeClockReader } from "../../../src/scope/scopeAuthorityResolution";
import { mapFiniteApplicationAdmissionFailure } from "../../../src/execution/journal/journalFailures";
import { readFrozenFiniteAttempt } from "../../../src/execution/journal/frozenAttempt";
import { observeFiniteAdmissionCleanupFault, expectFiniteAdmissionCleanupReasons } from "./finiteApplicationAdmissionCauseFault";

export type FiniteApplicationAdmissionFixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type Harness = Effect.Success<ReturnType<typeof makeFiniteIndexedQueriesHarness>>;
type CompoundObservationFailure = Effect.Error<ReturnType<Harness["store"]["runApplicationPointOperationEffect"]>> |
  Effect.Error<ReturnType<Harness["store"]["runApplicationIndexedQueryEffect"]>>;
export type FiniteApplicationAdmissionEntry = Effect.Success<ReturnType<Harness["open"]>>;
const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);
const revokedIssue = { _tag: "SessionJournalAttemptUnavailableV1Error", issue: { reason: "authorizationRevocationEpochChanged" } };

export const revokeFiniteApplicationScope = Effect.fn("FiniteApplicationAdmission.revoke")(
  function* (native: Pick<FiniteApplicationAdmissionFixture, "target" | "authority">) {
    return yield* runEffectTransaction<
      Effect.Success<ReturnType<typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect>>,
      Effect.Error<ReturnType<typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect>>,
      unknown, FlarexMetadataTransaction>(
      run => native.target.drizzle.transaction(run), "Admission revocation rolled back",
      tx => advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, native.authority.scopeId), cause => cause);
  },
);

/** Every root is issued by preparation, signed grant verification and finite
 * activation. Revocation uses the production writer; no local boolean stands
 * in for the header's authority decision. */
export const finiteApplicationAdmissionScenario = Effect.fn("FiniteApplicationAdmission.scenario")(
  function* (native: FiniteApplicationAdmissionFixture) {
    return yield* Effect.scoped(Effect.gen(function* () {
      const harness = yield* makeFiniteIndexedQueriesHarness(native);
      const { store, alphaId } = harness;
      const point = (entry: FiniteApplicationAdmissionEntry, seq: bigint, documentId: unknown = alphaId) =>
        store.runApplicationPointOperationEffect(entry.attempt, "users", { kind: "get", syscallSequence: sequence(seq), documentId }, entry.validator);
      const range = (entry: FiniteApplicationAdmissionEntry, seq: bigint) => store.runApplicationIndexedQueryEffect(
        entry.attempt, "users", "by_name", { kind: "indexRange", syscallSequence: sequence(seq), bounds: {}, limit: 4 });

      const control = yield* harness.open();
      const first = yield* point(control, 1n);
      if (first.kind !== "completed") throw new Error("Genuine point control was refused");
      expect(first).toMatchObject({ kind: "completed", delivery: "executed", outcome: { kind: "present", document: { name: "Alpha" } } });
      expect(yield* point(control, 1n)).toMatchObject({ kind: "completed", delivery: "replayed", outcome: first.outcome });
      const firstRange = yield* range(control, 2n);
      if (firstRange.kind !== "completed") throw new Error("Genuine range control was refused");
      expect(yield* range(control, 2n)).toMatchObject({ kind: "completed", delivery: "replayed", outcome: firstRange.outcome });
      expect(yield* point(control, 3n)).toMatchObject({ kind: "completed", delivery: "executed", outcome: first.outcome });
      const driver = yield* Effect.acquireRelease(Effect.sync(observeFiniteApplicationAdmissionDriver),
        observation => Effect.sync(() => observation.restore()));
      const knownOperations: readonly Effect.Effect<void, CompoundObservationFailure, never>[] = [
        point(control, 3n).pipe(Effect.asVoid), range(control, 2n).pipe(Effect.asVoid), point(control, 4n).pipe(Effect.asVoid),
      ];
      for (const operation of knownOperations) {
        driver.begin();
        yield* operation.pipe(Effect.ensuring(Effect.sync(() => driver.stop())));
        expect(driver.captures).toHaveLength(1);
        expect(driver.captures[0]).toMatchObject({ tableId: null, indexDefinitionId: null, uniqueDefinitionId: null, rawRows: 0 });
      }
      const closed = yield* harness.freeze(control);
      // Exact receipt replay adds neither operations nor dependency duplicates.
      expect(closed.view.operations.map(operation => operation.sequence)).toEqual([1n, 2n, 3n, 4n]);
      expect(closed.view.dependencies.filter(dependency => dependency.kind === "appRowPoint" && dependency.documentId === alphaId)).toHaveLength(1);
      driver.begin();
      expect(yield* store.runPointOperationEffect(control.table, { kind: "get", documentId: alphaId,
        syscallSequence: sequence(5n) }, control.validator)).toMatchObject({ kind: "stateRejected", issue: { reason: "journalFailed" } });
      expect(yield* store.runIndexedQueryEffect(control.index, { kind: "indexRange", syscallSequence: sequence(5n), bounds: {}, limit: 4 }))
        .toMatchObject({ kind: "stateRejected", issue: { reason: "journalFailed" } });
      expect(yield* Effect.flip(store.resolvePointTableEffect(control.attempt, "users")))
        .toMatchObject({ _tag: "SessionJournalStorageCorruptionV1Error", reason: "journalStateInvalid" });
      expect(yield* Effect.flip(store.resolveDeveloperIndexEffect(control.table, "by_name")))
        .toMatchObject({ _tag: "SessionJournalStorageCorruptionV1Error", reason: "journalStateInvalid" });
      expect(yield* Effect.flip(point(control, 5n)))
        .toMatchObject({ _tag: "SessionJournalStorageCorruptionV1Error", reason: "journalStateInvalid" });
      expect(yield* Effect.flip(range(control, 5n)))
        .toMatchObject({ _tag: "SessionJournalStorageCorruptionV1Error", reason: "journalStateInvalid" });
      driver.stop();
      expect(driver.captures).toEqual([]);
      expect(readFrozenFiniteAttempt(closed.command.frozenAttempt)).toEqual(closed.view);

      const malformedBody = yield* harness.open();
      yield* point(malformedBody, 1n);
      driver.begin(true);
      expect(yield* Effect.flip(point(malformedBody, 2n)).pipe(Effect.ensuring(Effect.sync(() => driver.stop()))))
        .toMatchObject({ _tag: "SessionJournalStorageCorruptionV1Error", cause: { _tag: "FiniteStorageCaptureError", reason: "storedCorruption" } });
      expect(driver.captures).toHaveLength(1);

      // Preserve the first runtime witness as the correct eligibility refusal:
      // ordinary users has no published application-command ownership policy.
      const ordinaryCommand = yield* harness.open();
      expect(yield* Effect.flip(store.preparePrivateApplicationCommandEffect(ordinaryCommand.attempt, "users")))
        .toMatchObject({ _tag: "InvalidSessionJournalCapabilityV1Error", capability: "attempt" });

      const cases = [];
      for (const kind of ["knownPoint", "pointReplay", "rangeReplay", "pendingKey", "missingTable", "badReadId", "badRange"] as const) {
        const entry = yield* harness.open();
        if (kind === "knownPoint" || kind === "pointReplay") yield* point(entry, 1n);
        if (kind === "rangeReplay") yield* range(entry, 1n);
        if (kind === "pendingKey") {
          yield* store.runApplicationPointOperationEffect(entry.attempt, "users", { kind: "patch", syscallSequence: sequence(1n),
            documentId: alphaId, patch: { name: "Z".repeat(3_000) } }, entry.validator);
        }
        cases.push({ kind, entry });
      }
      const before = yield* Effect.tryPromise(() => inventory(native));
      const sessionsBefore = yield* Effect.tryPromise(() => native.target.drizzle.select().from(fxSystemTransactionSessions));
      yield* revokeFiniteApplicationScope(native);
      for (const { kind, entry } of cases) {
        const operation: Effect.Effect<unknown, unknown> = kind === "rangeReplay" ? range(entry, 1n) : kind === "pendingKey" ? range(entry, 2n) :
          kind === "missingTable" ? store.runApplicationPointOperationEffect(entry.attempt, "missing", null, entry.validator) :
          kind === "badReadId" ? point(entry, 1n, "not-a-document-id") :
          kind === "badRange" ? store.runApplicationIndexedQueryEffect(entry.attempt, "users", null, null) :
          point(entry, kind === "pointReplay" ? 1n : 2n);
        expect(yield* Effect.flip(operation), kind).toMatchObject(revokedIssue);
        expect(yield* Effect.flip(store.freezeFiniteRootEffect(entry.attempt,
          yield* canonicalizeSuccessfulResultV1Effect(null))), kind).toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      }
      // Admission never renews lease/claim times or installs provisional state.
      expect(yield* Effect.tryPromise(() => native.target.drizzle.select().from(fxSystemTransactionSessions))).toEqual(sessionsBefore);
      const after = yield* Effect.tryPromise(() => inventory(native));
      expect({ ...after, clock: [] }).toEqual({ ...before, clock: [] });

      // The same pending-key request without revocation retains its exact owner.
      const invalidKey = yield* harness.open();
      yield* store.runApplicationPointOperationEffect(invalidKey.attempt, "users", { kind: "patch", syscallSequence: sequence(1n),
        documentId: alphaId, patch: { name: "Z".repeat(3_000) } }, invalidKey.validator);
      expect(yield* Effect.flip(range(invalidKey, 2n))).toMatchObject({ _tag: "OrderedIndexKeyTooLargeError", observedBytes: 3_002, maximumBytes: 2_048 });

      // Method phases are intentional: syntax first, table before read decoder,
      // descriptor before range decoder, then strict operation capture.
      for (const [tableName, input, expected] of [
        ["bad table", null, { _tag: "InvalidSessionJournalInputV1Error", reason: "invalidTableName" }],
        ["missing", null, { _tag: "PinnedPointTableNotFoundV1Error" }],
        ["users", null, { _tag: "UnsupportedPointMutationJournalOperationV1Error" }],
      ] as const) {
        const entry = yield* harness.open();
        expect(yield* Effect.flip(store.runApplicationPointOperationEffect(entry.attempt, tableName, input, entry.validator))).toMatchObject(expected);
      }
      const missingIndex = yield* harness.open();
      expect(yield* Effect.flip(store.runApplicationIndexedQueryEffect(missingIndex.attempt, "users", "missing", null)))
        .toMatchObject({ _tag: "SessionJournalDeveloperIndexUnavailableV1Error", reason: "definitionNotFound" });
      const malformedIndex = yield* harness.open();
      expect(yield* Effect.flip(store.runApplicationIndexedQueryEffect(malformedIndex.attempt, "users", null, null)))
        .toMatchObject({ _tag: "InvalidSessionJournalInputV1Error", reason: "invalidIndexDescriptor" });

      // Explicit native-response fault witnesses test only lifecycle decoding
      // and journal projection. They do not manufacture a legal stored abort or
      // establish priority between simultaneous durable lifecycle conditions.
      for (const lifecycle of ["finishing", "aborted", "expired"] as const) {
        const entry = yield* harness.open();
        driver.begin(false, false, lifecycle);
        expect(yield* Effect.flip(point(entry, 1n)).pipe(Effect.ensuring(Effect.sync(() => driver.stop()))))
          .toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error",
          issue: { reason: "attemptNotRunning", lifecycle } });
      }
      for (const malformedLifecycle of [null, "running", "unknown-lifecycle"] as const) {
        const entry = yield* harness.open();
        driver.begin(false, false, malformedLifecycle);
        expect(yield* Effect.flip(point(entry, 1n)).pipe(Effect.ensuring(Effect.sync(() => driver.stop()))))
          .toMatchObject({ _tag: "SessionJournalStorageCorruptionV1Error", cause: { _tag: "FiniteStorageCaptureError", reason: "storedCorruption" } });
      }
      // This real terminalization owner retains the finite claim. Its actual
      // aborted lifecycle therefore wins over simultaneous scope revocation.
      const aborted = yield* harness.open();
      const terminalization = createPointMutationSessionAttemptTerminalizationPersistenceV1(native.sessionAuthority);
      yield* terminalization.abortEffect({ selector: aborted.context.anchor,
        expectedSnapshotToken: aborted.context.anchor.snapshotToken, executionClaim: aborted.activation.executionClaim });
      yield* revokeFiniteApplicationScope(native);
      expect(yield* Effect.flip(point(aborted, 1n))).toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error",
        issue: { reason: "attemptNotRunning", lifecycle: "aborted" } });

      const missing = yield* harness.open();
      yield* Effect.tryPromise(() => native.target.drizzle.delete(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, missing.activation.anchor.sessionId)));
      expect(yield* Effect.flip(point(missing, 1n))).toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error", issue: { reason: "sessionMissing" } });

      // Publication nonacceptance is the distinct real owner that advances the
      // finite claim fence while aborting a revoked root. Probe its genuine
      // capture effect, without reopening the frozen logical journal.
      const rejected = yield* harness.open();
      const rejectObservation = observeActualFiniteAdmission();
      yield* point(rejected, 1n).pipe(Effect.ensuring(Effect.sync(() => rejectObservation.restore())));
      const rejectedAdmission = rejectObservation.captured();
      const rejectedFrozen = yield* harness.freeze(rejected);
      yield* revokeFiniteApplicationScope(native);
      expect(yield* harness.publisher.resolveFinite(rejectedFrozen.command)).toMatchObject({ kind: "rejected" });
      const rejectedFailure = yield* Effect.flip(rejectedAdmission);
      expect(rejectedFailure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "ownershipChanged" });
      expect(mapFiniteApplicationAdmissionFailure(rejectedFrozen.view.attemptState, rejectedFailure, "runPointOperation"))
        .toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error", issue: { reason: "executionClaimUnavailable" }, cause: rejectedFailure });

      // Replacement authority is derived from a real failed OCC publication
      // and its locked nonacceptance proof, never a fabricated successor row.
      const stale = yield* harness.open();
      const captureObservation = observeActualFiniteAdmission();
      yield* point(stale, 1n).pipe(Effect.ensuring(Effect.sync(() => captureObservation.restore())));
      const actualAdmission = captureObservation.captured();
      const staleFrozen = yield* harness.freeze(stale);
      const competitor = yield* harness.open();
      yield* store.runApplicationPointOperationEffect(competitor.attempt, "users", { kind: "patch", syscallSequence: sequence(1n),
        documentId: alphaId, patch: { name: "Replacement competitor" } }, competitor.validator);
      expect(yield* harness.publisher.publishFinite((yield* harness.freeze(competitor)).command)).toMatchObject({ kind: "published" });
      expect(yield* Effect.flip(harness.publisher.publishFinite(staleFrozen.command))).toMatchObject({ _tag: "PointCommitConflictV1Error" });
      const resolved = yield* harness.publisher.resolveFinite(staleFrozen.command);
      if (resolved.kind !== "noncommit") throw new Error("Actual OCC conflict did not issue nonacceptance proof");
      const replacement = createPointMutationAttemptReplacementPortV1(native.sessionAuthority, {
        leaseDurationMilliseconds: 240_000, executionClaimDurationMilliseconds: 60_000,
        finiteEntry: () => Effect.succeed({ application: harness.prepared.application,
          prepareEntry: () => store.prepareFiniteEntryEffect([]).pipe(Effect.mapError(cause => new PointMutationAttemptReplacementFiniteEntryError({ cause }))) }),
      });
      expect(yield* replacement.replaceFinite({ ...staleFrozen.command, proof: resolved.proof })).toMatchObject({ kind: "replaced" });
      // Replay the actual capture owner effect, while its genuine metadata host
      // remains open. The frozen journal itself remains terminal and untouched.
      const replacedFailure = yield* Effect.flip(actualAdmission);
      expect(replacedFailure).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "attemptReplaced" });
      expect(mapFiniteApplicationAdmissionFailure(staleFrozen.view.attemptState, replacedFailure, "runPointOperation"))
        .toMatchObject({ _tag: "SessionJournalAttemptUnavailableV1Error", issue: { reason: "staleAttemptFence" }, cause: replacedFailure });
      driver.begin(false, true);
      expect(yield* Effect.flip(actualAdmission).pipe(Effect.ensuring(Effect.sync(() => driver.stop()))))
        .toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "storedCorruption" });
      expect(readFrozenFiniteAttempt(staleFrozen.command.frozenAttempt)).toEqual(staleFrozen.view);

      // A real refused admission plus a failing cleanup must retain all reasons
      // through the journal projection, including interruption and defect identity.
      const mixed = yield* harness.open();
      yield* point(mixed, 1n);
      const mixedBefore = yield* Effect.tryPromise(() => inventory(native));
      yield* revokeFiniteApplicationScope(native);
      const fault = yield* Effect.acquireRelease(Effect.sync(observeFiniteAdmissionCleanupFault),
        observation => Effect.sync(() => observation.restore()));
      fault.arm();
      let mixedDeliveries = 0;
      const mixedExit = yield* Effect.exit(point(mixed, 2n).pipe(Effect.tap(() => Effect.sync(() => { mixedDeliveries += 1; }))));
      if (Exit.isSuccess(mixedExit)) throw new Error("Mixed-Cause revoked admission delivered a value");
      expectFiniteAdmissionCleanupReasons(mixedExit.cause, fault);
      expect(mixedExit.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "Fail",
        error: expect.objectContaining({ _tag: "SessionJournalAttemptUnavailableV1Error",
          issue: { reason: "authorizationRevocationEpochChanged" } }) })]));
      expect(mixedExit.cause.reasons.some(reason => reason._tag === "Fail" &&
        reason.error._tag === "SessionJournalAttemptUnavailableV1Error" && fault.captureCauses.some(captureCause =>
          captureCause.reasons.some(original => original._tag === "Fail" && reason.error.cause === original.error)))).toBe(true);
      expect(mixedDeliveries).toBe(0);
      expect(yield* Effect.flip(store.freezeFiniteRootEffect(mixed.attempt, yield* canonicalizeSuccessfulResultV1Effect(null))))
        .toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
      const mixedAfter = yield* Effect.tryPromise(() => inventory(native));
      expect({ ...mixedAfter, clock: [] }).toEqual({ ...mixedBefore, clock: [] });
    }));
  },
);

/** Observation only. Retains the exact owner effect built during a genuine
 * open operation and always delegates it unchanged. No capability is forged. */
function observeActualFiniteAdmission() {
  const recorded: { effect?: Effect.Effect<void, FiniteStorageCaptureError> } = {};
  const actualCapture = finiteStorageCapture.captureFiniteStorageEffect;
  const observer = vi.spyOn(finiteStorageCapture, "captureFiniteStorageEffect").mockImplementation(
    function <K extends FiniteStorageCaptureOperation["kind"]>(target: LocatedScopeClockReader,
      input: ExactRunningAttemptKernelInputV1, operation: Extract<FiniteStorageCaptureOperation, { kind: K }>) {
      const effect = actualCapture<K>(target, input, operation);
      if (operation.kind === "admission") recorded.effect = effect.pipe(Effect.asVoid);
      return effect;
    });
  return { restore: () => observer.mockRestore(), captured: () => {
    if (recorded.effect === undefined) throw new Error("No actual owner-issued admission effect was observed");
    return recorded.effect;
  } };
}
