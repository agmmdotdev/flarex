import { Effect } from "effect";
import type {
  CanonicalSessionJournalV1,
  CanonicalSuccessfulResultV1,
  StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";

import type {
  PinnedPointTableV1,
  PreparedSessionJournalSealResultV1,
  PreparedSessionJournalSealV1,
  RunSessionJournalPointOperationV1Result,
  SessionJournalAttemptV1,
  SessionJournalPointOperationV1,
  SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";

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
  store: SessionJournalStorePersistenceV1,
  table: PinnedPointTableV1,
  operation: SessionJournalPointOperationV1,
): Promise<RunSessionJournalPointOperationV1Result> {
  return runEffect(store.runPointOperationEffect(table, operation));
}

export function prepareSessionJournalSeal(
  store: SessionJournalStorePersistenceV1,
  attempt: SessionJournalAttemptV1,
): Promise<PreparedSessionJournalSealResultV1> {
  return runEffect(store.prepareSealEffect(attempt));
}

export function completeSessionJournalSeal(
  store: SessionJournalStorePersistenceV1,
  preparation: PreparedSessionJournalSealV1,
  journal: CanonicalSessionJournalV1,
  successfulResult: CanonicalSuccessfulResultV1,
): Promise<StoredForSessionAttemptCommitEnvelopeV1> {
  return runEffect(
    store.completeSealEffect(preparation, journal, successfulResult),
  );
}
