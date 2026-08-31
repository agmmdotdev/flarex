import { Cause, Clock, Data, Effect, Exit } from "effect";

import type { FlarexMetadataDatabase } from "../../deployments";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";

const frameworkSchemaArtifactControlSessionStarterBrand: unique symbol =
  Symbol("FlarexDB/FrameworkSchemaArtifactControlSessionStarter");
const frameworkSchemaArtifactControlDeadlineBrand: unique symbol =
  Symbol("FlarexDB/FrameworkSchemaArtifactControlDeadline");
const frameworkSchemaArtifactControlConnectionIdentityBrand: unique symbol =
  Symbol("FlarexDB/FrameworkSchemaArtifactControlConnectionIdentity");
const frameworkSchemaArtifactControlSessionTransactionBrand: unique symbol =
  Symbol("FlarexDB/FrameworkSchemaArtifactControlSessionTransaction");

export type FrameworkSchemaArtifactControlDeadlineKind =
  | "read"
  | "initial"
  | "recovery";

export type FrameworkSchemaArtifactControlSessionPhase =
  | "acquire"
  | "configureReadBudget"
  | "read"
  | "resetReadBudget"
  | "begin"
  | "isolation"
  | "configureTransactionBudget"
  | "callback"
  | "commit"
  | "rollback"
  | "release"
  | "quarantine";

export class FrameworkSchemaArtifactControlSessionDeadlineIssue extends
  Data.TaggedError("FrameworkSchemaArtifactControlSessionDeadlineIssue")<{
    readonly deadlineKind: FrameworkSchemaArtifactControlDeadlineKind;
    readonly phase: FrameworkSchemaArtifactControlSessionPhase;
  }>
{}

export class FrameworkSchemaArtifactControlSessionResourceIssue extends
  Data.TaggedError("FrameworkSchemaArtifactControlSessionResourceIssue")<{
    readonly phase: FrameworkSchemaArtifactControlSessionPhase;
    readonly cause: unknown;
    readonly cleanupCause?: unknown;
  }>
{}

export class FrameworkSchemaArtifactControlSessionDecisionUncertainIssue extends
  Data.TaggedError(
    "FrameworkSchemaArtifactControlSessionDecisionUncertainIssue",
  )<{
    readonly stage: "settle" | "recover";
    readonly initialSettlementCause: unknown;
    readonly resolutionCause: unknown;
  }>
{}

export class FrameworkSchemaArtifactControlSessionCleanupDefect extends
  Data.TaggedError("FrameworkSchemaArtifactControlSessionCleanupDefect")<{
    readonly phase: "rollback" | "release" | "quarantine";
    readonly cause: unknown;
  }>
{}

export class FrameworkSchemaArtifactControlSessionInvariantDefect extends
  Data.TaggedError("FrameworkSchemaArtifactControlSessionInvariantDefect")<{
    readonly reason:
      | "invalidStarter"
      | "invalidDeadline"
      | "invalidDeadlineDuration"
      | "invalidTransaction"
      | "crossStarterTransaction"
      | "closedTransaction";
  }>
{}

export interface FrameworkSchemaArtifactControlSessionStarter {
  readonly [frameworkSchemaArtifactControlSessionStarterBrand]: true;
}

export interface FrameworkSchemaArtifactControlDeadline {
  readonly [frameworkSchemaArtifactControlDeadlineBrand]: true;
}

export interface FrameworkSchemaArtifactControlConnectionIdentity {
  readonly [frameworkSchemaArtifactControlConnectionIdentityBrand]: true;
}

/** Opaque transaction capability issued only for one active driver callback. */
export interface FrameworkSchemaArtifactControlSessionTransaction {
  readonly [frameworkSchemaArtifactControlSessionTransactionBrand]: true;
}

export type FrameworkSchemaArtifactControlDecision<Value> =
  | Readonly<{ readonly kind: "created"; readonly value: Value }>
  | Readonly<{ readonly kind: "existing"; readonly value: Value }>
  | Readonly<{ readonly kind: "resolveExisting" }>;

export interface FrameworkSchemaArtifactControlResult<Value> {
  readonly status: "created" | "existing";
  readonly value: Value;
}

export type FrameworkSchemaArtifactControlSessionQuarantine =
  | Readonly<{
      readonly kind: "confirmed";
      readonly excludedConnectionIdentity:
        FrameworkSchemaArtifactControlConnectionIdentity;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly cause: unknown;
    }>;

export type FrameworkSchemaArtifactControlInitialSettlement<Value, Failure> =
  | Readonly<{ readonly kind: "committed"; readonly value: Value }>
  | Readonly<{
      readonly kind: "callbackRolledBack";
      readonly callbackCause: Cause.Cause<
        Failure | FrameworkSchemaArtifactControlSessionResourceIssue
      >;
    }>
  | Readonly<{
      readonly kind: "callbackCleanupFailed";
      readonly callbackCause: Cause.Cause<
        Failure | FrameworkSchemaArtifactControlSessionResourceIssue
      >;
      readonly cleanupCause: Cause.Cause<never>;
    }>
  | Readonly<{
      readonly kind: "notCommitted";
      readonly cause: Cause.Cause<
        FrameworkSchemaArtifactControlSessionResourceIssue
      >;
    }>
  | Readonly<{
      readonly kind: "uncertain";
      readonly value: Value;
      readonly initialSettlementCause: unknown;
      readonly recoveryDeadline: FrameworkSchemaArtifactControlDeadline;
      readonly quarantine: FrameworkSchemaArtifactControlSessionQuarantine;
    }>;

export type FrameworkSchemaArtifactControlRecoveryResolution<Failure> =
  | Readonly<{
      readonly kind: "callback";
      readonly cause: Cause.Cause<
        Failure | FrameworkSchemaArtifactControlSessionResourceIssue
      >;
    }>
  | Readonly<{
      readonly kind: "lifecycle";
      readonly cause: Cause.Cause<
        FrameworkSchemaArtifactControlSessionResourceIssue
      >;
    }>;

export type FrameworkSchemaArtifactControlRecoverySettlement<
  Value,
  Failure,
> =
  | Readonly<{ readonly kind: "committed"; readonly value: Value }>
  | Readonly<{
      readonly kind: "unresolved";
      readonly resolution:
        FrameworkSchemaArtifactControlRecoveryResolution<Failure>;
    }>;

export interface FrameworkSchemaArtifactControlReadInput {
  readonly deadline: FrameworkSchemaArtifactControlDeadline;
}

export type FrameworkSchemaArtifactControlRestore = <Value, Failure>(
  effect: Effect.Effect<Value, Failure, never>,
) => Effect.Effect<Value, Failure, never>;

export interface FrameworkSchemaArtifactControlInitialTransactionInput {
  readonly deadline: FrameworkSchemaArtifactControlDeadline;
  readonly lockTimeoutMilliseconds: number;
  readonly recoveryTimeoutMilliseconds: number;
}

export interface FrameworkSchemaArtifactControlRecoveryTransactionInput {
  readonly deadline: FrameworkSchemaArtifactControlDeadline;
  readonly lockTimeoutMilliseconds: number;
  readonly excludedConnectionIdentity:
    FrameworkSchemaArtifactControlConnectionIdentity;
}

export interface FrameworkSchemaArtifactControlSessionDriver {
  readonly runReadEffect: <Value, Failure>(
    input: FrameworkSchemaArtifactControlReadInput,
    work: (
      database: FlarexMetadataDatabase,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.Effect<
    Value,
    Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
    never
  >;
  readonly runInitialTransactionEffect: <Value, Failure>(
    input: FrameworkSchemaArtifactControlInitialTransactionInput,
    restore: FrameworkSchemaArtifactControlRestore,
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.Effect<
    FrameworkSchemaArtifactControlInitialSettlement<Value, Failure>,
    never,
    never
  >;
  readonly runRecoveryTransactionEffect: <Value, Failure>(
    input: FrameworkSchemaArtifactControlRecoveryTransactionInput,
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.Effect<
    FrameworkSchemaArtifactControlRecoverySettlement<Value, Failure>,
    never,
    never
  >;
}

export interface MakeFrameworkSchemaArtifactControlSessionStarterInput {
  readonly controlDb: FlarexMetadataDatabase;
  readonly driver: FrameworkSchemaArtifactControlSessionDriver;
}

export interface FrameworkSchemaArtifactControlWork<Value, Failure> {
  readonly runLockedEffect: (
    transaction: FrameworkSchemaArtifactControlSessionTransaction,
    attempt: "initial" | "recovery",
  ) => Effect.Effect<
    FrameworkSchemaArtifactControlDecision<Value>,
    Failure,
    never
  >;
  readonly resolveExistingEffect: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<
    Value,
    Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
    never
  >;
}

export interface RunFrameworkSchemaArtifactControlInput {
  readonly initialDeadline: FrameworkSchemaArtifactControlDeadline;
  readonly lockTimeoutMilliseconds: number;
  readonly recoveryTimeoutMilliseconds: number;
}

interface FrameworkSchemaArtifactControlSessionStarterState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly driver: FrameworkSchemaArtifactControlSessionDriver;
}

interface FrameworkSchemaArtifactControlDeadlineState {
  readonly kind: FrameworkSchemaArtifactControlDeadlineKind;
  readonly startedAtNanoseconds: bigint;
  readonly expiresAtNanoseconds: bigint;
}

interface FrameworkSchemaArtifactControlSessionTransactionState {
  readonly starter: FrameworkSchemaArtifactControlSessionStarter;
  readonly rawTransaction: FlarexMetadataTransaction;
  active: boolean;
}

const starterStates = new WeakMap<
  object,
  FrameworkSchemaArtifactControlSessionStarterState
>();
const deadlineStates = new WeakMap<
  object,
  FrameworkSchemaArtifactControlDeadlineState
>();
const transactionStates = new WeakMap<
  object,
  FrameworkSchemaArtifactControlSessionTransactionState
>();

/** Issue one opaque starter bound to one exact control database and driver. */
export function makeFrameworkSchemaArtifactControlSessionStarter(
  input: MakeFrameworkSchemaArtifactControlSessionStarterInput,
): FrameworkSchemaArtifactControlSessionStarter {
  const starter = Object.freeze({
    [frameworkSchemaArtifactControlSessionStarterBrand]: true,
  } satisfies FrameworkSchemaArtifactControlSessionStarter);
  starterStates.set(starter, Object.freeze({
    controlDb: input.controlDb,
    driver: input.driver,
  } satisfies FrameworkSchemaArtifactControlSessionStarterState));
  return starter;
}

/** Issue one process-local identity for a physically acquired connection. */
export function makeFrameworkSchemaArtifactControlConnectionIdentity():
  FrameworkSchemaArtifactControlConnectionIdentity
{
  return Object.freeze({
    [frameworkSchemaArtifactControlConnectionIdentityBrand]: true,
  } satisfies FrameworkSchemaArtifactControlConnectionIdentity);
}

/**
 * Authenticate one active callback capability before repository code can bind
 * the underlying raw transaction to its own narrower token.
 */
export function withFrameworkSchemaArtifactRawControlSessionTransactionEffect<
  Value,
  Failure,
>(
  transaction: FrameworkSchemaArtifactControlSessionTransaction,
  expectedStarter: FrameworkSchemaArtifactControlSessionStarter,
  work: (
    rawTransaction: FlarexMetadataTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<Value, Failure, never> {
  return Effect.suspend(() => {
    const state = transactionStates.get(transaction);
    if (state === undefined) {
      return Effect.die(
        new FrameworkSchemaArtifactControlSessionInvariantDefect({
          reason: "invalidTransaction",
        }),
      );
    }
    if (!state.active) {
      return Effect.die(
        new FrameworkSchemaArtifactControlSessionInvariantDefect({
          reason: "closedTransaction",
        }),
      );
    }
    if (state.starter !== expectedStarter) {
      return Effect.die(
        new FrameworkSchemaArtifactControlSessionInvariantDefect({
          reason: "crossStarterTransaction",
        }),
      );
    }
    return work(state.rawTransaction);
  });
}

/** Authenticate the exact starter/control-database pair without property reads. */
export function hasFrameworkSchemaArtifactControlSessionComposition(
  starter: unknown,
  controlDb: FlarexMetadataDatabase,
): starter is FrameworkSchemaArtifactControlSessionStarter {
  if (typeof starter !== "object" || starter === null) return false;
  return starterStates.get(starter)?.controlDb === controlDb;
}

/** Capture one absolute Effect-clock deadline. */
export function startFrameworkSchemaArtifactControlDeadline(
  kind: FrameworkSchemaArtifactControlDeadlineKind,
  timeoutMilliseconds: number,
): Effect.Effect<FrameworkSchemaArtifactControlDeadline, never, never> {
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0
  ) {
    return Effect.die(
      new FrameworkSchemaArtifactControlSessionInvariantDefect({
        reason: "invalidDeadlineDuration",
      }),
    );
  }

  return Clock.currentTimeNanos.pipe(Effect.map((startedAtNanoseconds) => {
    const deadline = Object.freeze({
      [frameworkSchemaArtifactControlDeadlineBrand]: true,
    } satisfies FrameworkSchemaArtifactControlDeadline);
    deadlineStates.set(deadline, Object.freeze({
      kind,
      startedAtNanoseconds,
      expiresAtNanoseconds: startedAtNanoseconds +
        BigInt(timeoutMilliseconds) * 1_000_000n,
    } satisfies FrameworkSchemaArtifactControlDeadlineState));
    return deadline;
  }));
}

/** Read the positive remaining whole-millisecond budget from one deadline. */
export function remainingFrameworkSchemaArtifactControlMilliseconds(
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: FrameworkSchemaArtifactControlSessionPhase,
): Effect.Effect<
  number,
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  never
> {
  const state = deadlineStates.get(deadline);
  if (state === undefined) {
    return Effect.die(
      new FrameworkSchemaArtifactControlSessionInvariantDefect({
        reason: "invalidDeadline",
      }),
    );
  }

  return Clock.currentTimeNanos.pipe(Effect.flatMap((currentNanoseconds) => {
    const remainingNanoseconds = state.expiresAtNanoseconds -
      currentNanoseconds;
    const remainingMilliseconds = remainingNanoseconds / 1_000_000n;
    if (remainingMilliseconds < 1n) {
      return Effect.fail(
        new FrameworkSchemaArtifactControlSessionDeadlineIssue({
          deadlineKind: state.kind,
          phase,
        }),
      );
    }
    return Effect.succeed(Number(remainingMilliseconds));
  }));
}

/** Fail one in-flight phase with the authenticated deadline's exact kind. */
export function failFrameworkSchemaArtifactControlDeadline(
  deadline: FrameworkSchemaArtifactControlDeadline,
  phase: FrameworkSchemaArtifactControlSessionPhase,
): Effect.Effect<
  never,
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  never
> {
  const state = deadlineStates.get(deadline);
  return state === undefined
    ? Effect.die(
      new FrameworkSchemaArtifactControlSessionInvariantDefect({
        reason: "invalidDeadline",
      }),
    )
    : Effect.fail(
      new FrameworkSchemaArtifactControlSessionDeadlineIssue({
        deadlineKind: state.kind,
        phase,
      }),
    );
}

/** Run one bounded read through the starter-owned connection adapter. */
export function runFrameworkSchemaArtifactControlReadEffect<Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  input: FrameworkSchemaArtifactControlReadInput,
  work: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return runControlReadEffect(
    starter,
    input,
    "read",
    work,
  );
}

/** Run the optimistic admission read under its enclosing initial deadline. */
export function runFrameworkSchemaArtifactControlInitialReadEffect<
  Value,
  Failure,
>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  input: FrameworkSchemaArtifactControlReadInput,
  work: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return runControlReadEffect(
    starter,
    input,
    "initial",
    work,
  );
}

export type RunFrameworkSchemaArtifactControl = <Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  input: RunFrameworkSchemaArtifactControlInput,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
) => Effect.Effect<
  FrameworkSchemaArtifactControlResult<Value>,
  | Failure
  | FrameworkSchemaArtifactControlSessionResourceIssue
  | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  never
>;

/**
 * Own one initial attempt and, only after confirmed quarantine, at most one
 * recovery attempt. The raw transaction is supplied only to the repository's
 * closure; repository code must immediately replace it with its scoped token.
 */
export const runFrameworkSchemaArtifactControlEffect:
  RunFrameworkSchemaArtifactControl = Effect.fn(
    "FrameworkSchemaArtifactControlSession.run",
  )(<Value, Failure>(
    starter: FrameworkSchemaArtifactControlSessionStarter,
    input: RunFrameworkSchemaArtifactControlInput,
    work: FrameworkSchemaArtifactControlWork<Value, Failure>,
  ): Effect.Effect<
    FrameworkSchemaArtifactControlResult<Value>,
    | Failure
    | FrameworkSchemaArtifactControlSessionResourceIssue
    | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
    never
  > => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    const terminal = yield* Effect.exit(runControlLifecycle(
      starter,
      input,
      work,
      restore,
    ));
    const pending = yield* Effect.exit(restore(Effect.void));

    if (Exit.isFailure(pending)) {
      if (Exit.isSuccess(terminal)) {
        return yield* Effect.failCause(pending.cause);
      }
      const recordedInterruptors = new Set(
        terminal.cause.reasons
          .filter(Cause.isInterruptReason)
          .map(reason => reason.fiberId),
      );
      const newPendingReasons = pending.cause.reasons.filter(reason =>
        !Cause.isInterruptReason(reason) ||
        !recordedInterruptors.has(reason.fiberId)
      );
      return yield* Effect.failCause(newPendingReasons.length === 0
        ? terminal.cause
        : Cause.combine(
          terminal.cause,
          Cause.fromReasons(newPendingReasons),
        ));
    }
    if (Exit.isFailure(terminal)) {
      return yield* Effect.failCause(terminal.cause);
    }
    return terminal.value;
  })));

const runControlLifecycle = Effect.fn(
  "FrameworkSchemaArtifactControlSession.lifecycle",
)(function*<Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  input: RunFrameworkSchemaArtifactControlInput,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
  restore: FrameworkSchemaArtifactControlRestore,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlResult<Value>,
  | Failure
  | FrameworkSchemaArtifactControlSessionResourceIssue
  | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue
> {
    const state = yield* starterStateEffect(starter);
    yield* requireDeadlineKind(input.initialDeadline, "initial");

    const initial = yield* state.driver.runInitialTransactionEffect(
      {
        deadline: input.initialDeadline,
        lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
        recoveryTimeoutMilliseconds: input.recoveryTimeoutMilliseconds,
      },
      restore,
      (transaction) => withIssuedControlSessionTransactionEffect(
        starter,
        transaction,
        controlTransaction =>
          work.runLockedEffect(controlTransaction, "initial"),
      ),
    );

    switch (initial.kind) {
      case "committed":
        return yield* resolveCommittedDecision(
          state.driver,
          initial.value,
          input.initialDeadline,
          work,
        );
      case "callbackRolledBack":
        return yield* Effect.failCause(initial.callbackCause);
      case "callbackCleanupFailed":
        return yield* Effect.failCause(Cause.combine(
          initial.callbackCause,
          initial.cleanupCause,
        ));
      case "notCommitted":
        return yield* Effect.failCause(initial.cause);
      case "uncertain":
        return yield* resolveInitialUncertainty(
          starter,
          state.driver,
          initial,
          input,
          work,
        );
    }
});

function resolveCommittedDecision<Value, Failure>(
  driver: FrameworkSchemaArtifactControlSessionDriver,
  decision: FrameworkSchemaArtifactControlDecision<Value>,
  deadline: FrameworkSchemaArtifactControlDeadline,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
): Effect.Effect<
  FrameworkSchemaArtifactControlResult<Value>,
  Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  switch (decision.kind) {
    case "created":
      return Effect.succeed(Object.freeze({
        status: "created",
        value: decision.value,
      }));
    case "existing":
      return Effect.succeed(Object.freeze({
        status: "existing",
        value: decision.value,
      }));
    case "resolveExisting":
      return driver.runReadEffect(
        { deadline },
        work.resolveExistingEffect,
      ).pipe(Effect.map((value) => Object.freeze({
        status: "existing" as const,
        value,
      })));
  }
}

function resolveInitialUncertainty<Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  driver: FrameworkSchemaArtifactControlSessionDriver,
  initial: Extract<
    FrameworkSchemaArtifactControlInitialSettlement<
      FrameworkSchemaArtifactControlDecision<Value>,
      Failure
    >,
    { readonly kind: "uncertain" }
  >,
  input: RunFrameworkSchemaArtifactControlInput,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
): Effect.Effect<
  FrameworkSchemaArtifactControlResult<Value>,
  | Failure
  | FrameworkSchemaArtifactControlSessionResourceIssue
  | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  never
> {
  return Effect.flatMap(
    requireDeadlineKind(initial.recoveryDeadline, "recovery"),
    (): Effect.Effect<
      FrameworkSchemaArtifactControlResult<Value>,
      | Failure
      | FrameworkSchemaArtifactControlSessionResourceIssue
      | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
      never
    > => Effect.suspend((): Effect.Effect<
      FrameworkSchemaArtifactControlResult<Value>,
      | Failure
      | FrameworkSchemaArtifactControlSessionResourceIssue
      | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
      never
    > => {
      if (initial.quarantine.kind === "failed") {
        return failDecisionUncertain(
          "settle",
          initial.initialSettlementCause,
          initial.quarantine.cause,
        );
      }

      if (initial.value.kind !== "created") {
        return driver.runReadEffect(
          { deadline: initial.recoveryDeadline },
          work.resolveExistingEffect,
        ).pipe(Effect.map((value) => Object.freeze({
          status: "existing" as const,
          value,
        })));
      }

      return runRecovery(
        starter,
        driver,
        initial.recoveryDeadline,
        initial.quarantine.excludedConnectionIdentity,
        initial.initialSettlementCause,
        input.lockTimeoutMilliseconds,
        work,
      );
    }),
  );
}

const runRecovery = Effect.fn(
  "FrameworkSchemaArtifactControlSession.runRecovery",
)(function*<Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  driver: FrameworkSchemaArtifactControlSessionDriver,
  deadline: FrameworkSchemaArtifactControlDeadline,
  excludedConnectionIdentity:
    FrameworkSchemaArtifactControlConnectionIdentity,
  initialSettlementCause: unknown,
  lockTimeoutMilliseconds: number,
  work: FrameworkSchemaArtifactControlWork<Value, Failure>,
): Effect.fn.Return<
  FrameworkSchemaArtifactControlResult<Value>,
  FrameworkSchemaArtifactControlSessionDecisionUncertainIssue
> {
    const recovery = yield* driver.runRecoveryTransactionEffect(
      {
        deadline,
        lockTimeoutMilliseconds,
        excludedConnectionIdentity,
      },
      (transaction) => withIssuedControlSessionTransactionEffect(
        starter,
        transaction,
        controlTransaction =>
          work.runLockedEffect(controlTransaction, "recovery"),
      ),
    );

    if (recovery.kind === "unresolved") {
      const resolutionCause = recovery.resolution.cause;
      return yield* failDecisionUncertain(
        "recover",
        initialSettlementCause,
        resolutionCause,
        recovery.resolution.cause,
      );
    }

    switch (recovery.value.kind) {
      case "created":
        return Object.freeze({
          status: "created",
          value: recovery.value.value,
        });
      case "existing":
        return Object.freeze({
          status: "existing",
          value: recovery.value.value,
        });
      case "resolveExisting": {
        const resolution = yield* Effect.exit(driver.runReadEffect(
          { deadline },
          work.resolveExistingEffect,
        ));
        if (Exit.isFailure(resolution)) {
          return yield* failDecisionUncertain(
            "recover",
            initialSettlementCause,
            resolution.cause,
            resolution.cause,
          );
        }
        return Object.freeze({
          status: "existing",
          value: resolution.value,
        });
      }
    }
});

function withIssuedControlSessionTransactionEffect<Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  rawTransaction: FlarexMetadataTransaction,
  work: (
    transaction: FrameworkSchemaArtifactControlSessionTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<Value, Failure, never> {
  return Effect.suspend(() => {
    const state: FrameworkSchemaArtifactControlSessionTransactionState = {
      starter,
      rawTransaction,
      active: true,
    };
    const transaction = Object.freeze({
      [frameworkSchemaArtifactControlSessionTransactionBrand]: true,
    } satisfies FrameworkSchemaArtifactControlSessionTransaction);
    transactionStates.set(transaction, state);
    return Effect.suspend(() => work(transaction)).pipe(
      Effect.ensuring(Effect.sync(() => {
        state.active = false;
      })),
    );
  });
}

function requireDeadlineKind(
  deadline: FrameworkSchemaArtifactControlDeadline,
  expectedKind: FrameworkSchemaArtifactControlDeadlineKind,
): Effect.Effect<void, never, never> {
  const state = deadlineStates.get(deadline);
  return state?.kind === expectedKind
    ? Effect.void
    : Effect.die(
      new FrameworkSchemaArtifactControlSessionInvariantDefect({
        reason: "invalidDeadline",
      }),
    );
}

function starterStateEffect(
  starter: FrameworkSchemaArtifactControlSessionStarter,
): Effect.Effect<
  FrameworkSchemaArtifactControlSessionStarterState,
  never,
  never
> {
  const state = starterStates.get(starter);
  return state === undefined
    ? Effect.die(
      new FrameworkSchemaArtifactControlSessionInvariantDefect({
        reason: "invalidStarter",
      }),
    )
    : Effect.succeed(state);
}

function runControlReadEffect<Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  input: FrameworkSchemaArtifactControlReadInput,
  deadlineKind: Extract<
    FrameworkSchemaArtifactControlDeadlineKind,
    "read" | "initial"
  >,
  work: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | FrameworkSchemaArtifactControlSessionResourceIssue,
  never
> {
  return Effect.flatMap(
    requireDeadlineKind(input.deadline, deadlineKind),
    () => Effect.flatMap(starterStateEffect(starter), (state) =>
      state.driver.runReadEffect(input, work)),
  );
}

function failDecisionUncertain(
  stage: "settle" | "recover",
  initialSettlementCause: unknown,
  resolutionCause: unknown,
  operationalCause?: Cause.Cause<unknown>,
): Effect.Effect<
  never,
  FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  never
> {
  const issue = new
    FrameworkSchemaArtifactControlSessionDecisionUncertainIssue({
      stage,
      initialSettlementCause,
      resolutionCause,
    });
  const typedCause = Cause.fail(issue);
  return Effect.failCause(operationalCause === undefined
    ? typedCause
    : Cause.combine(
      typedCause,
      Cause.map(operationalCause, () => issue),
    ));
}
