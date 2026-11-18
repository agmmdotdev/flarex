import type { FlarexMetadataDatabase } from "../application/deployments";
import { LocatedReadCommittedTransactionFailureV1 } from "../execution/readCommittedTransactionFailure";
import type { AppRowTransaction } from "../storage/documents/appRows";
import type { RunLocatedReadCommittedTransactionV1 } from "./locatedTransactionIdentity";

interface LocatedReadCommittedSettlementState {
  phase: "configuring" | "running" | "completed" | "rejected";
  callbackCause: unknown;
}

/** Source-private transaction mechanics. Trusted construction owns admission. */
export function createReadCommittedTransactionRunner(
  db: FlarexMetadataDatabase,
  configure: (tx: AppRowTransaction) => Promise<void>,
  finalize?: (tx: AppRowTransaction) => void,
): RunLocatedReadCommittedTransactionV1 {
  return async <Result>(work: (
    tx: AppRowTransaction,
  ) => Promise<Result>): Promise<Result> => {
    const state: LocatedReadCommittedSettlementState = { phase: "configuring", callbackCause: undefined };
    try {
      return await db.transaction(async (tx) => {
        await tx.setTransaction({ isolationLevel: "read committed" });
        await configure(tx);
        state.phase = "running";
        try {
          const result = await work(tx);
          state.phase = "completed";
          return result;
        } catch (cause) {
          state.phase = "rejected";
          state.callbackCause = cause;
          throw cause;
        } finally {
          finalize?.(tx);
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
