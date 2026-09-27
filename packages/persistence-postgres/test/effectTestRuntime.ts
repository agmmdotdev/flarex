import { Effect } from "effect";
import type {
  CanonicalSessionJournal,
  CanonicalSuccessfulResultV1,
  StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";

import type {
  PinnedPointTableV1,
  PreparedSessionJournalSealResultV1,
  PreparedSessionJournalSealV1,
  RunSessionJournalPointOperationV1Result,
  SessionJournalAttempt,
  SessionJournalPointOperationV1,
  SessionJournalStorePersistence,
} from "../src/sessionJournalStore";
import { SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1 } from
  "./applicationRevisionSyscallValidatorTestSupport";

/** One explicit Promise bridge for Effect-based persistence tests. */
export function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

/** One explicit Promise bridge for asserting typed Effect failures. */
export function runEffectFailure<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

export function runSessionJournalPointOperation(
  store: SessionJournalStorePersistence,
  table: PinnedPointTableV1,
  operation: SessionJournalPointOperationV1,
): Promise<RunSessionJournalPointOperationV1Result> {
  return runEffect(store.runPointOperationEffect(
    table,
    operation,
    SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
  ));
}

export function prepareSessionJournalSeal(
  store: SessionJournalStorePersistence,
  attempt: SessionJournalAttempt,
): Promise<PreparedSessionJournalSealResultV1> {
  return runEffect(store.prepareSealEffect(attempt));
}

export function completeSessionJournalSeal(
  store: SessionJournalStorePersistence,
  preparation: PreparedSessionJournalSealV1,
  journal: CanonicalSessionJournal,
  successfulResult: CanonicalSuccessfulResultV1,
): Promise<StoredForSessionAttemptCommitEnvelopeV1> {
  return runEffect(
    store.completeSealEffect(preparation, journal, successfulResult),
  );
}
