import { Effect } from "effect";

import type {
  PinnedPointTableV1,
  RunSessionJournalPointOperationV1Result,
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
