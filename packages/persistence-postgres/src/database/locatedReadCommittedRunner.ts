import type { FlarexMetadataDatabase } from "../application/deployments";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../execution/readCommittedTransactionFailure";
import {
  acquireCoLocatedInstallationAdmission,
  acquireInstallationAdmission,
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
  type PreparedCoLocatedReadInstallation,
  type PreparedInstallation,
} from "../installation/installationLifecycle";
import type { PreparedInstalledAttemptScopeAuthority } from "../scope/scopeAuthorityControlRead";
import type { AppRowTransaction } from "../storage/documents/appRows";
import type { RunLocatedReadCommittedTransactionV1 } from "./locatedTransactionIdentity";
import { Effect, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

interface LocatedReadCommittedSettlementState {
  phase: "configuring" | "running" | "completed" | "rejected";
  callbackCause: unknown;
}

/**
 * Package-internal construction seam shared by narrowly located persistence
 * capabilities. Its package route is restricted to trusted construction.
 */
export function createDefaultLocatedReadCommittedTransactionRunnerV1(
  db: FlarexMetadataDatabase,
  installation?: Readonly<{ kind: "coLocated"; installation: PreparedCoLocatedReadInstallation }> |
    Readonly<{ kind: "direct"; installation: PreparedInstallation }>,
  accepting?: Readonly<{ owner: PreparedInstalledAttemptScopeAuthority;
    selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>; protection: "share" | "attempt" }>,
): RunLocatedReadCommittedTransactionV1 {
  return async <Result>(work: (
    tx: AppRowTransaction,
  ) => Promise<Result>): Promise<Result> => {
    const state: LocatedReadCommittedSettlementState = { phase: "configuring", callbackCause: undefined };
    try {
      return await db.transaction(async (tx) => {
        await tx.setTransaction({ isolationLevel: "read committed" });
        if (accepting !== undefined) Result.getOrThrowWith(accepting.owner.requireDatabase(db), cause => cause);
        if (accepting === undefined) await Effect.runPromise(installation === undefined ? lockInstallationForCurrentTransaction(tx)
          : installation.kind === "coLocated" ? acquireCoLocatedInstallationAdmission(installation.installation, db, tx).pipe(Effect.asVoid)
          : acquireInstallationAdmission(installation.installation, db, tx).pipe(Effect.asVoid));
        state.phase = "running";
        try {
          const result = await work(tx);
          if (accepting !== undefined) Result.getOrThrowWith(
            accepting.owner.requireAcceptedTransaction(tx, accepting.selection, accepting.protection), cause => cause);
          state.phase = "completed";
          return result;
        } catch (cause) {
          state.phase = "rejected";
          state.callbackCause = cause;
          throw cause;
        } finally {
          accepting?.owner.closeAcceptedTransaction(tx);
          closeInstallationAdmission(tx);
        }
      });
    } catch (cause) {
      if (state.phase === "rejected" && cause === state.callbackCause) {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "callbackRolledBack",
          callbackCause: state.callbackCause,
        }));
      }
      if (state.phase === "rejected") {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "callbackCleanupFailed",
          callbackCause: state.callbackCause,
          transactionCause: cause,
        }));
      }
      if (state.phase === "completed") {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: cause,
        }));
      }
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "infrastructureFailure",
        phase: "beginOrConfigure",
        cause,
      }));
    }
  };
}
