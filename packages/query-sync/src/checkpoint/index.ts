import { Cause, Clock, Data, Effect, Exit, Fiber, Option, Result, Schema } from "effect";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const position = Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n));
const sourceId = Schema.NonEmptyString.check(Schema.isMaxLength(256));

export const CheckpointSchema = Schema.Struct({ sourceId, position }).annotate(strict);
export type Checkpoint = typeof CheckpointSchema.Type;
export const CheckpointStateSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("initialized") }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("ready"), checkpoint: CheckpointSchema }).annotate(strict),
]);
export type CheckpointState = typeof CheckpointStateSchema.Type;
export const CheckpointCertificateSchema = Schema.Struct({
  namespaceId: Schema.NonEmptyString,
  sourceId,
  after: Schema.NullOr(position),
  retainedFrom: position,
  through: position,
}).annotate(strict);
export type CheckpointCertificate = typeof CheckpointCertificateSchema.Type;
export const CheckpointBudgetSchema = Schema.Struct({
  sourceReads: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16 })),
  stateTransitions: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16 })),
  maximumElapsedMilliseconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
}).annotate(strict);
export type CheckpointBudget = typeof CheckpointBudgetSchema.Type;

export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly reason: "invalidBudget" | "initializationRequired" | "stateConflict"
    | "sourceUnavailable" | "invalidEvidence" | "invalidCheckpoint"
    | "stateCorrupt" | "stateIncompatible" | "storageUnavailable";
  readonly cause?: unknown;
}> {}

export type CheckpointSourceResult =
  | Readonly<{ kind: "certified"; certificate: CheckpointCertificate }>
  | Readonly<{ kind: "resetRequired"; reason: "historyUnavailable" | "sourceReplaced" }>;

export interface CheckpointSource {
  readonly certify: (request: Readonly<{ checkpoint: Checkpoint | undefined;
    maximumElapsedMilliseconds: number }>) => Effect.Effect<CheckpointSourceResult, CheckpointError>;
}

/** Each state instance belongs to exactly one namespace; operations settle atomically. */
export interface CheckpointStore {
  readonly inspect: Effect.Effect<CheckpointState | null, CheckpointError>;
  /** Explicit fresh authorization is checked by the coordinator before this operation. */
  readonly initialize: Effect.Effect<CheckpointState, CheckpointError>;
  readonly advance: (expected: CheckpointState, certificate: CheckpointCertificate)
    => Effect.Effect<CheckpointState, CheckpointError>;
}

export interface CheckpointProgress {
  readonly sourceReads: number;
  readonly stateTransitions: number;
  readonly lastCheckpoint: Checkpoint | null;
}
export type CheckpointOutcome =
  | Readonly<{ kind: "caughtUp"; target: Checkpoint; checkpoint: Checkpoint; progress: CheckpointProgress }>
  | Readonly<{ kind: "continuationRequired";
    reason: "sourceReadLimitReached" | "stateTransitionLimitReached" | "deadlineReached";
    progress: CheckpointProgress }>
  | Readonly<{ kind: "resetRequired"; reason: "historyUnavailable" | "sourceReplaced";
    progress: CheckpointProgress }>;

const decodeBudget = Schema.decodeUnknownEffect(CheckpointBudgetSchema);
const decodeCertificate = Schema.decodeUnknownResult(CheckpointCertificateSchema);

function captureCheckpoint(value: Checkpoint): Checkpoint {
  return Object.freeze({ sourceId: value.sourceId, position: value.position });
}

function captureState(value: CheckpointState): CheckpointState {
  return value.kind === "initialized" ? Object.freeze({ kind: "initialized" })
    : Object.freeze({ kind: "ready", checkpoint: captureCheckpoint(value.checkpoint) });
}

/** Pure transition owner; adapters call this inside their atomic compare/advance. */
export function advanceCheckpointState(
  namespaceId: string, current: CheckpointState | null, expected: CheckpointState,
  certificate: CheckpointCertificate,
): Result.Result<CheckpointState, CheckpointError> {
  return Result.gen(function* () {
    const proof = yield* decodeCertificate(certificate).pipe(Result.mapError(cause =>
      new CheckpointError({ reason: "invalidEvidence", cause })));
    const requested = expected.kind === "ready" ? expected.checkpoint : undefined;
    if (proof.namespaceId !== namespaceId || proof.retainedFrom > proof.through
      || proof.after !== (requested?.position ?? null)
      || requested !== undefined && (proof.sourceId !== requested.sourceId
        || proof.after === null || proof.after < proof.retainedFrom || proof.after > proof.through)) {
      return yield* Result.fail(new CheckpointError({ reason: "invalidEvidence" }));
    }
    if (current === null || current.kind === "initialized" && expected.kind !== "initialized")
      return yield* Result.fail(new CheckpointError({ reason: "stateConflict" }));
    if (current.kind === "ready") {
      if (current.checkpoint.sourceId !== proof.sourceId
        || current.checkpoint.position < proof.retainedFrom
        || requested !== undefined && current.checkpoint.position < requested.position)
        return yield* Result.fail(new CheckpointError({ reason: "stateConflict" }));
      // Another same-source call may already have covered all or part of this interval.
      if (current.checkpoint.position >= proof.through) return captureState(current);
    }
    return Object.freeze({ kind: "ready", checkpoint: Object.freeze({
      sourceId: proof.sourceId, position: proof.through,
    }) });
  });
}

export interface CheckpointTurnInput {
  readonly namespaceId: string;
  readonly source: CheckpointSource;
  readonly store: CheckpointStore;
  readonly budget: CheckpointBudget;
  readonly authorizeFreshInitialization: boolean;
}

const certifyWithin = Effect.fn("Checkpoint.certifyWithin")((
  work: Effect.Effect<CheckpointSourceResult, CheckpointError>, milliseconds: number,
) => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
  // Own the source child separately. Race only its Exit waiter against the timer:
  // RC.112's race interruption joins losers but discards their cleanup failures.
  const source = yield* Effect.forkChild(restore(work));
  const waited = yield* Effect.exit(restore(Effect.raceFirst(
    Fiber.await(source).pipe(Effect.map(exit => ({ kind: "source" as const, exit }))),
    Effect.sleep(`${milliseconds} millis`).pipe(Effect.andThen(Effect.fiberId),
      Effect.map(interruptor => ({ kind: "deadline" as const, interruptor }))),
  )));
  if (Exit.isFailure(waited)) {
    yield* Fiber.interrupt(source);
    const completed = yield* Fiber.await(source);
    return yield* Effect.failCause(Exit.isFailure(completed)
      ? Cause.combine(waited.cause, completed.cause) : waited.cause);
  }
  if (waited.value.kind === "source") {
    const completed = waited.value.exit;
    if (Exit.isFailure(completed)) return yield* Effect.failCause(completed.cause);
    return Option.some(completed.value);
  }
  const interruptor = waited.value.interruptor;
  yield* Fiber.interruptAs(source, interruptor);
  const completed = yield* Fiber.await(source);
  if (Exit.isFailure(completed)) {
    const ownTimeout = completed.cause.reasons.length > 0 && completed.cause.reasons.every(reason =>
      Cause.isInterruptReason(reason) && reason.fiberId === interruptor);
    if (!ownTimeout) return yield* Effect.failCause(completed.cause);
  }
  return Option.none();
})));

/** One fixed source target per turn; progress is local processing, never commit authority. */
export const runCheckpointTurn = Effect.fn("Checkpoint.runTurn")(function* (
  input: CheckpointTurnInput,
): Effect.fn.Return<CheckpointOutcome, CheckpointError> {
  const { namespaceId, store, source, authorizeFreshInitialization } = input;
  const budget = yield* decodeBudget(input.budget).pipe(Effect.mapError(cause =>
    new CheckpointError({ reason: "invalidBudget", cause })));
  const deadline = (yield* Clock.monotonicTimeNanos) + BigInt(budget.maximumElapsedMilliseconds) * 1_000_000n;
  let state = yield* store.inspect.pipe(Effect.map(value => value === null ? null : captureState(value)));
  let sourceReads = 0;
  let stateTransitions = 0;
  const progress = (): CheckpointProgress => Object.freeze({ sourceReads, stateTransitions,
    lastCheckpoint: state?.kind === "ready" ? captureCheckpoint(state.checkpoint) : null });
  const continuation = (reason: Extract<CheckpointOutcome, { kind: "continuationRequired" }>["reason"]): CheckpointOutcome =>
    Object.freeze({ kind: "continuationRequired", reason, progress: progress() });
  if (state === null) {
    if (!authorizeFreshInitialization)
      return yield* new CheckpointError({ reason: "initializationRequired" });
    if ((yield* Clock.monotonicTimeNanos) >= deadline) return continuation("deadlineReached");
    if (budget.stateTransitions === 0) return continuation("stateTransitionLimitReached");
    state = captureState(yield* store.initialize);
    stateTransitions++;
  }
  if ((yield* Clock.monotonicTimeNanos) >= deadline) return continuation("deadlineReached");
  if (stateTransitions >= budget.stateTransitions) return continuation("stateTransitionLimitReached");
  if (sourceReads >= budget.sourceReads) return continuation("sourceReadLimitReached");
  const remaining = Number((deadline - (yield* Clock.monotonicTimeNanos)) / 1_000_000n);
  if (remaining <= 0) return continuation("deadlineReached");
  const expected = state;
  const checkpoint = expected.kind === "ready" ? captureCheckpoint(expected.checkpoint) : undefined;
  sourceReads++;
  // Read-only source timeout joins cancellation/drain. It cannot settle local state.
  const response = yield* certifyWithin(source.certify({ checkpoint, maximumElapsedMilliseconds: remaining }), remaining);
  if (Option.isNone(response)) return continuation("deadlineReached");
  if ((yield* Clock.monotonicTimeNanos) >= deadline) return continuation("deadlineReached");
  if (response.value.kind === "resetRequired") return Object.freeze({
    kind: "resetRequired", reason: response.value.reason, progress: progress(),
  });
  const proof = Object.freeze(yield* Effect.fromResult(decodeCertificate(response.value.certificate).pipe(
    Result.mapError(cause => new CheckpointError({ reason: "invalidEvidence", cause })),
  )));
  // Validate before adapter I/O, then validate against actual current state atomically there.
  yield* Effect.fromResult(advanceCheckpointState(namespaceId, expected, expected, proof));
  state = captureState(yield* store.advance(expected, proof));
  stateTransitions++;
  if ((yield* Clock.monotonicTimeNanos) >= deadline) return continuation("deadlineReached");
  if (state.kind !== "ready") return yield* new CheckpointError({ reason: "stateConflict" });
  return Object.freeze({ kind: "caughtUp", target: Object.freeze({ sourceId: proof.sourceId,
    position: proof.through }), checkpoint: captureCheckpoint(state.checkpoint), progress: progress() });
});
