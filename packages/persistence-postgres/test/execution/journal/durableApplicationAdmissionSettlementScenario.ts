import { Cause, Effect, Exit } from "effect";
import { expect, vi } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { deriveApplicationSyscallValidator } from "../../../src/application/revision/applicationRevisionSyscallValidatorV1";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { SessionJournalAttemptUnavailableV1Error, SessionJournalPersistenceV1Error } from "../../../src/execution/journal/errors";
import * as attemptKernel from "../../../src/execution/session/attemptKernel";
import { ExactRunningAttemptTransactionV1Error, PointMutationSessionAttemptLoadV1Error } from "../../../src/execution/session/errors";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../../src/scope/scopeClock";
import type { FlarexPersistence } from "../../../src/index";
import type { SessionJournalStorePGliteFixture } from "./journalFixture";

type Fixture = Pick<SessionJournalStorePGliteFixture, "scenario" | "journalCounts" | "journalRoot"> & {
  readonly persistence: FlarexPersistence & { readonly drizzle: FlarexMetadataDatabase };
};
const sequence = (value: bigint) => CommitSyscallSequenceV1Schema.make(value);

/** The actual callback and rollback settle before the test substitutes a
 * transport rejection. The existing transaction bridge, not this observer,
 * combines real admission refusal with that separate settlement failure. */
function observeDurableAdmissionSettlement(database: FlarexMetadataDatabase) {
  const settlementFailure = new Error("Controlled rejection after actual durable admission rollback");
  const events: string[] = [];
  const callbackRejections: unknown[] = [];
  const settledRejections: unknown[] = [];
  const kernelCauses: Cause.Cause<unknown>[] = [];
  const transactionOwners: Array<"scopeResolution" | "exactAdmission"> = [];
  const successfulTransactions: Array<"scopeResolution" | "exactAdmission"> = [];
  const failedTransactions: Array<"scopeResolution" | "exactAdmission"> = [];
  let admittedContinuations = 0;
  let transactionCalls = 0;
  let kernelCalls = 0;
  let activeKernels = 0;
  const actualTransaction = database.transaction;
  const transactionObserver = vi.spyOn(database, "transaction").mockImplementation(
    async function <A>(callback: Parameters<typeof actualTransaction<A>>[0], config?: Parameters<typeof actualTransaction<A>>[1]) {
      transactionCalls += 1;
      const owner = activeKernels === 0 ? "scopeResolution" : "exactAdmission";
      transactionOwners.push(owner);
      try {
        const result = await (actualTransaction<A>).call(database, async tx => {
          try { return await callback(tx); }
          catch (cause) { callbackRejections.push(cause); events.push("callbackRejected"); throw cause; }
        }, config);
        successfulTransactions.push(owner);
        events.push(owner === "scopeResolution" ? "scopeResolutionSettled" : "exactAdmissionSettled");
        return result;
      } catch (cause) {
        failedTransactions.push(owner);
        settledRejections.push(cause);
        events.push("rollbackSettled");
        // Preserve any unexpected native transport failure rather than masking
        // it as this controlled post-settlement test fault.
        if (owner !== "exactAdmission" || callbackRejections.length !== 1 || callbackRejections[0] !== cause) throw cause;
        events.push("settlementRejectionSubstituted");
        throw settlementFailure;
      }
    });
  const actualKernel = attemptKernel.runExactRunningAttemptEffectTransaction;
  const kernelObserver = vi.spyOn(attemptKernel, "runExactRunningAttemptEffectTransaction").mockImplementation(
    function <A, E>(...args: Parameters<typeof actualKernel<A, E>>) {
      const [db, input, work, afterLoadLock, clockProtection, installedAuthority, controlProtection] = args;
      return Effect.suspend(() => {
        kernelCalls += 1;
        activeKernels += 1;
        return actualKernel<A, E>(db, input, (tx, context) => Effect.suspend(() => {
          admittedContinuations += 1;
          return work(tx, context);
        }), afterLoadLock, clockProtection, installedAuthority, controlProtection).pipe(Effect.onExit(exit => Effect.sync(() => {
          if (Exit.isFailure(exit)) kernelCauses.push(exit.cause);
        })), Effect.ensuring(Effect.sync(() => { activeKernels -= 1; })));
      });
    });
  let restored = false;
  return { settlementFailure, events, callbackRejections, settledRejections, kernelCauses,
    transactionOwners, successfulTransactions, failedTransactions, kernelCalls: () => kernelCalls,
    admittedContinuations: () => admittedContinuations,
    transactionCalls: () => transactionCalls,
    restore() { if (!restored) { kernelObserver.mockRestore(); transactionObserver.mockRestore(); restored = true; } },
  };
}

export const durableApplicationAdmissionSettlementScenario = Effect.fn("DurableApplicationAdmissionSettlement.scenario")(
  function* (fixture: Fixture) {
    for (const kind of ["point", "index"] as const) {
      const current = yield* Effect.tryPromise(() => fixture.scenario(`mixed_settlement_${kind}`, {
        executionProfile: "durableOperations", developerIndex: true, seedFields: { name: "Ada" },
      }));
      expect(current.anchor.executionProfile).toBe("durableOperations");
      const documentId = current.seededDocumentId;
      if (documentId === null || current.developerIndex === null) throw new Error("Missing genuine seeded durable journal/index");
      const validator = yield* deriveApplicationSyscallValidator({ scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId, schemaManifest: current.schemaManifest });
      const point = (value: bigint) => current.store.runApplicationPointOperationEffect(current.attempt, "users",
        { kind: "get", syscallSequence: sequence(value), documentId }, validator);
      const index = (value: bigint) => current.store.runApplicationIndexedQueryEffect(current.attempt, "users", "by_name",
        { kind: "indexRange", syscallSequence: sequence(value), bounds: {}, limit: 4 });
      if (kind === "point") expect(yield* point(1n)).toMatchObject({ kind: "completed", outcome: { kind: "present" } });
      else expect(yield* index(1n)).toMatchObject({ kind: "completed", outcome: { documents: [{ name: "Ada" }] } });
      const beforeCounts = yield* Effect.tryPromise(() => fixture.journalCounts(current.anchor.sessionId));
      const beforeRoot = yield* Effect.tryPromise(() => fixture.journalRoot(current.anchor.sessionId));
      yield* runEffectTransaction<
        Effect.Success<ReturnType<typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect>>,
        Effect.Error<ReturnType<typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect>>,
        unknown, FlarexMetadataTransaction>(run => fixture.persistence.drizzle.transaction(run), "Durable admission revocation rolled back",
        tx => advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, current.anchor.scopeId), cause => cause);
      const observation = yield* Effect.acquireRelease(Effect.sync(() => observeDurableAdmissionSettlement(fixture.persistence.drizzle)),
        owner => Effect.sync(() => owner.restore()));
      let delivered = 0;
      type CompoundFailure = Effect.Error<ReturnType<typeof point>> | Effect.Error<ReturnType<typeof index>>;
      const operation: Effect.Effect<unknown, CompoundFailure, never> = kind === "point" ? point(2n) : index(2n);
      const result = yield* Effect.exit(operation.pipe(Effect.tap(() => Effect.sync(() => { delivered += 1; })))).pipe(
        Effect.ensuring(Effect.sync(() => observation.restore())));
      if (Exit.isSuccess(result)) throw new Error("Revoked durable compound delivered a value");
      // RuntimePersistence.getScopeMetadata first uses the installation-protected
      // control reader's own successful short transaction. Only the following
      // exact-attempt transaction refuses and receives the settlement fault.
      expect(observation.transactionCalls()).toBe(2);
      expect(observation.transactionOwners).toEqual(["scopeResolution", "exactAdmission"]);
      expect(observation.successfulTransactions).toEqual(["scopeResolution"]);
      expect(observation.failedTransactions).toEqual(["exactAdmission"]);
      expect(observation.kernelCalls()).toBe(1);
      expect(observation.admittedContinuations()).toBe(0);
      expect(observation.events).toEqual(["scopeResolutionSettled", "callbackRejected", "rollbackSettled", "settlementRejectionSubstituted"]);
      expect(observation.callbackRejections).toHaveLength(1);
      expect(observation.settledRejections).toHaveLength(1);
      expect(observation.settledRejections[0]).toBe(observation.callbackRejections[0]);
      expect(observation.kernelCauses).toHaveLength(1);
      const kernelCause = observation.kernelCauses[0];
      if (kernelCause === undefined) throw new Error("Actual durable kernel Cause was not observed");
      expect(kernelCause.reasons).toHaveLength(2);
      expect(kernelCause.reasons.every(Cause.isFailReason)).toBe(true);
      expect(result.cause.reasons).toHaveLength(2);
      expect(result.cause.reasons.every(Cause.isFailReason)).toBe(true);
      const mappedFailures = result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
      const kernelFailures = kernelCause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
      expect(mappedFailures.filter(error => error instanceof SessionJournalAttemptUnavailableV1Error)).toHaveLength(1);
      expect(mappedFailures.filter(error => error instanceof SessionJournalPersistenceV1Error)).toHaveLength(1);
      for (const failure of kernelFailures) {
        expect(failure).toBeInstanceOf(ExactRunningAttemptTransactionV1Error);
        if (!(failure instanceof ExactRunningAttemptTransactionV1Error)) throw new Error("Missing actual exact-attempt error");
        expect(failure.callbackCause).toBeUndefined();
        if (failure.cause instanceof PointMutationSessionAttemptLoadV1Error) {
          const originalRefusal = failure.cause;
          expect(originalRefusal.issue).toEqual({ reason: "authorizationRevocationEpochChanged" });
          expect(mappedFailures.some(mapped => mapped instanceof SessionJournalAttemptUnavailableV1Error && mapped.issue === originalRefusal.issue)).toBe(true);
        } else {
          expect(failure.cause).toBe(observation.settlementFailure);
          expect(mappedFailures.some(mapped => mapped instanceof SessionJournalPersistenceV1Error &&
            mapped.operation === "resolvePinnedPointTable" && mapped.cause === failure)).toBe(true);
        }
      }
      expect(delivered).toBe(0);
      expect(yield* Effect.tryPromise(() => fixture.journalCounts(current.anchor.sessionId))).toEqual(beforeCounts);
      expect(yield* Effect.tryPromise(() => fixture.journalRoot(current.anchor.sessionId))).toEqual(beforeRoot);
    }
  },
);
