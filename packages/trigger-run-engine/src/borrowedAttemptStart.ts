import type { Effect, Option } from "effect";
import type {
  AttemptRun, AttemptStartIntent, CreateExecutionSnapshotInput, ExecutionSnapshot,
  FailedRun, PermanentFailureWrite, StartedRun, StartAttemptWrite,
} from "./model.js";

/**
 * A future trusted core issuer lends this already-live single-run operation.
 * Its closures bind target/run/operation/claim/fence/lifetime and enforce those
 * predicates at every read/write. This structural type is not an authority issuer.
 * The engine never opens/settles a transaction or passes a capability to a handler.
 * All methods participate in the same outer settlement; results are tentative.
 */
export interface BorrowedAttemptStart<StoreError, StoreEnvironment = never> {
  readonly runId: string;
  readonly databaseTimeMs: number;
  readonly readLatestSnapshot: () => Effect.Effect<ExecutionSnapshot, StoreError, StoreEnvironment>;
  readonly findRun: () => Effect.Effect<Option.Option<AttemptRun>, StoreError, StoreEnvironment>;
  readonly startAttempt: (input: StartAttemptWrite) => Effect.Effect<StartedRun, StoreError, StoreEnvironment>;
  readonly clearBlockingWaitpoints: () => Effect.Effect<void, StoreError, StoreEnvironment>;
  readonly failRunPermanently: (input: PermanentFailureWrite) => Effect.Effect<FailedRun, StoreError, StoreEnvironment>;
  readonly createExecutionSnapshot: (input: CreateExecutionSnapshotInput) => Effect.Effect<ExecutionSnapshot, StoreError, StoreEnvironment>;
  readonly recordIntent: (intent: AttemptStartIntent) => Effect.Effect<void, StoreError, StoreEnvironment>;
}
