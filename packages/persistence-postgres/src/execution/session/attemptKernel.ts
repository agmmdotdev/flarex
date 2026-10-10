import type { FlarexMetadataDatabase } from "../../application/deployments";
import { runPointCommitPromiseEffect } from "../../commit/point/promiseBoundary";
import { runEffectTransactionSettlement } from "../../database/effectTransaction";
import {
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
} from "../../installation/installationLifecycle";
import type { PreparedInstalledAttemptScopeAuthority } from "../../scope/scopeAuthorityControlRead";
import {
  closeExactAttemptScopeClockObservation,
  closeFiniteExecutionAuthorityObservation,
  openExactAttemptScopeClockObservation,
} from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  closeProtectedMetadataFinalGuardScope,
  flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope,
  registerProtectedMetadataTransactionFinalGuard,
  type ProtectedMetadataPreparation,
} from "../preparation/preparedMetadataEpoch";
import { decodeLockedPointMutationSessionClock } from "./attemptAuthority";
import {
  lockExactRunningAttemptInTransaction,
  runningAttemptKernelContextResult,
} from "./attemptLoad";
import type { LocatedPointMutationSessionActivationTargetOptionsV1 } from "./constructionContracts";
import { ExactRunningAttemptTransactionV1Error } from "./errors";
import { closeFiniteEntryLeaseExpectation } from "./finiteSession";
import type {
  ExactRunningAttemptEffectWorkV1,
  ExactRunningAttemptKernelInputV1,
} from "./kernelContracts";
import { Cause, Effect } from "effect";

/** The shared bridge owns full callback Cause and native settlement; this
 * exact-attempt owner retains admission, final guards and cleanup. */
export function runExactRunningAttemptEffectTransaction<Result, Failure>(
  db: FlarexMetadataDatabase,
  input: ExactRunningAttemptKernelInputV1,
  work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
  clockProtection: "share" | "attempt",
  installedAuthority?: PreparedInstalledAttemptScopeAuthority,
  controlProtection?: ProtectedMetadataPreparation,
): Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error> {
  return Effect.uninterruptible(runEffectTransactionSettlement<Result, Failure | ExactRunningAttemptTransactionV1Error,
    ExactRunningAttemptTransactionV1Error, AppRowTransaction>(callback => db.transaction(callback),
    "Effect exact-attempt work failed; roll back the transaction.", tx =>
      Effect.uninterruptible(Effect.gen(function* () {
        const admission = Effect.gen(function* () {
          const installed = installedAuthority === undefined ? undefined :
            yield* installedAuthority.lock(tx, input.selector, clockProtection);
          if (installed === undefined) yield* lockInstallationForCurrentTransaction(tx);
          const locked = yield* runPointCommitPromiseEffect(() => lockExactRunningAttemptInTransaction(
            tx, input, afterLoadLock, clockProtection,
            installed === undefined ? undefined : decodeLockedPointMutationSessionClock(installed.row)), cause => cause);
          const context = yield* Effect.fromResult(runningAttemptKernelContextResult(locked, tx));
          openProtectedMetadataFinalGuardScope(tx);
          openExactAttemptScopeClockObservation(tx, locked.clock.record,
            locked.clock.authorizationRevocationEpoch, clockProtection);
          return context;
        }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
          failure => new ExactRunningAttemptTransactionV1Error({ cause: failure, callbackCause: undefined })))));
        const context = yield* admission;
        if (installedAuthority !== undefined) {
          if (controlProtection === undefined) return yield* Effect.die("Installed attempt lost its protected control preparation");
          yield* registerProtectedMetadataTransactionFinalGuard(controlProtection, db, tx).pipe(Effect.mapError(cause =>
            new ExactRunningAttemptTransactionV1Error({ cause, callbackCause: undefined })));
        }
        const value = yield* Effect.suspend(() => work(tx, context));
        yield* flushProtectedMetadataFinalGuards(tx).pipe(Effect.mapError(cause =>
          new ExactRunningAttemptTransactionV1Error({ cause, callbackCause: undefined })));
        return value;
      }).pipe(Effect.ensuring(Effect.sync(() => {
        closeExactAttemptScopeClockObservation(tx);
        closeFiniteExecutionAuthorityObservation(tx);
        closeFiniteEntryLeaseExpectation(tx);
        closeProtectedMetadataFinalGuardScope(tx);
        closeInstallationAdmission(tx);
      })))), cause => new ExactRunningAttemptTransactionV1Error({ cause, callbackCause: undefined })));
}
