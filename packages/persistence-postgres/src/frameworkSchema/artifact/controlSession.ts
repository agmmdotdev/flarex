import {
  makePhysicalDeadlineOperations,
  type PhysicalDeadline,
} from "../../physicalSession/deadline";
import type {
  PhysicalDeadlineKind,
  PhysicalSessionPhase,
  PhysicalConnectionIdentity,
  PhysicalSessionQuarantine,
  PhysicalInitialSettlement,
  PhysicalRecoveryResolution,
  PhysicalRecoverySettlement,
  PhysicalReadInput,
  PhysicalRestore,
  PhysicalInitialTransactionInput,
  PhysicalRecoveryTransactionInput,
  PhysicalSessionDriver,
  PhysicalSessionErrors,
} from "../../physicalSession/model";
import { Cause, Data, Effect, Exit } from "effect";

import type { FlarexMetadataDatabase } from "../../deployments";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";

const frameworkSchemaArtifactControlSessionStarterBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkSchemaArtifactControlSessionStarter",
);
const frameworkSchemaArtifactControlSessionTransactionBrand: unique symbol =
  Symbol("FlarexDB/FrameworkSchemaArtifactControlSessionTransaction");

export type FrameworkSchemaArtifactControlDeadlineKind = PhysicalDeadlineKind;
export type FrameworkSchemaArtifactControlSessionPhase = PhysicalSessionPhase;
export class FrameworkSchemaArtifactControlSessionDeadlineIssue extends Data.TaggedError(
  "FrameworkSchemaArtifactControlSessionDeadlineIssue",
)<{
  readonly deadlineKind: FrameworkSchemaArtifactControlDeadlineKind;
  readonly phase: FrameworkSchemaArtifactControlSessionPhase;
}> {}

export class FrameworkSchemaArtifactControlSessionResourceIssue extends Data.TaggedError(
  "FrameworkSchemaArtifactControlSessionResourceIssue",
)<{
  readonly phase: FrameworkSchemaArtifactControlSessionPhase;
  readonly cause: unknown;
  readonly cleanupCause?: unknown;
}> {}

export class FrameworkSchemaArtifactControlSessionDecisionUncertainIssue extends Data.TaggedError(
  "FrameworkSchemaArtifactControlSessionDecisionUncertainIssue",
)<{
  readonly stage: "settle" | "recover";
  readonly initialSettlementCause: unknown;
  readonly resolutionCause: unknown;
}> {}

export class FrameworkSchemaArtifactControlSessionCleanupDefect extends Data.TaggedError(
  "FrameworkSchemaArtifactControlSessionCleanupDefect",
)<{
  readonly phase: "rollback" | "release" | "quarantine";
  readonly cause: unknown;
}> {}

export class FrameworkSchemaArtifactControlSessionInvariantDefect extends Data.TaggedError(
  "FrameworkSchemaArtifactControlSessionInvariantDefect",
)<{
  readonly reason:
    | "invalidStarter"
    | "invalidDeadline"
    | "invalidDeadlineDuration"
    | "invalidTransaction"
    | "crossStarterTransaction"
    | "closedTransaction";
}> {}

export interface FrameworkSchemaArtifactControlSessionStarter {
  readonly [frameworkSchemaArtifactControlSessionStarterBrand]: true;
}

export type FrameworkSchemaArtifactControlDeadline = PhysicalDeadline;
export type FrameworkSchemaArtifactControlConnectionIdentity =
  PhysicalConnectionIdentity;

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
  PhysicalSessionQuarantine;
export type FrameworkSchemaArtifactControlInitialSettlement<Value, Failure> =
  PhysicalInitialSettlement<
    Value,
    Failure,
    FrameworkSchemaArtifactControlSessionResourceIssue
  >;
export type FrameworkSchemaArtifactControlRecoveryResolution<Failure> =
  PhysicalRecoveryResolution<
    Failure,
    FrameworkSchemaArtifactControlSessionResourceIssue
  >;
export type FrameworkSchemaArtifactControlRecoverySettlement<Value, Failure> =
  PhysicalRecoverySettlement<
    Value,
    Failure,
    FrameworkSchemaArtifactControlSessionResourceIssue
  >;
export type FrameworkSchemaArtifactControlReadInput = PhysicalReadInput;
export type FrameworkSchemaArtifactControlRestore = PhysicalRestore;
export type FrameworkSchemaArtifactControlInitialTransactionInput =
  PhysicalInitialTransactionInput;
export type FrameworkSchemaArtifactControlRecoveryTransactionInput =
  PhysicalRecoveryTransactionInput;
export type FrameworkSchemaArtifactControlSessionDriver =
  PhysicalSessionDriver<FrameworkSchemaArtifactControlSessionResourceIssue>;

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

interface FrameworkSchemaArtifactControlSessionTransactionState {
  readonly starter: FrameworkSchemaArtifactControlSessionStarter;
  readonly rawTransaction: FlarexMetadataTransaction;
  active: boolean;
}

const starterStates = new WeakMap<
  object,
  FrameworkSchemaArtifactControlSessionStarterState
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
  starterStates.set(
    starter,
    Object.freeze({
      controlDb: input.controlDb,
      driver: input.driver,
    } satisfies FrameworkSchemaArtifactControlSessionStarterState),
  );
  return starter;
}

export { makePhysicalConnectionIdentity as makeFrameworkSchemaArtifactControlConnectionIdentity } from "../../physicalSession/model";

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

/** Artifact error identity is projected at emission; physical mechanics stay neutral. */
export const artifactControlPhysicalErrors: PhysicalSessionErrors<
  FrameworkSchemaArtifactControlSessionResourceIssue,
  FrameworkSchemaArtifactControlSessionDeadlineIssue
> = {
  resource: (fields) =>
    new FrameworkSchemaArtifactControlSessionResourceIssue(fields),
  deadline: (fields) =>
    new FrameworkSchemaArtifactControlSessionDeadlineIssue(fields),
  invariant: (fields) =>
    new FrameworkSchemaArtifactControlSessionInvariantDefect(fields),
  cleanup: (fields) =>
    new FrameworkSchemaArtifactControlSessionCleanupDefect(fields),
};
const physicalDeadlines = makePhysicalDeadlineOperations(
  artifactControlPhysicalErrors,
);
export const startFrameworkSchemaArtifactControlDeadline =
  physicalDeadlines.start;
export const remainingFrameworkSchemaArtifactControlMilliseconds =
  physicalDeadlines.remaining;
export const failFrameworkSchemaArtifactControlDeadline =
  physicalDeadlines.fail;

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
  return runControlReadEffect(starter, input, "read", work);
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
  return runControlReadEffect(starter, input, "initial", work);
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
export const runFrameworkSchemaArtifactControlEffect: RunFrameworkSchemaArtifactControl =
  Effect.fn("FrameworkSchemaArtifactControlSession.run")(
    <Value, Failure>(
      starter: FrameworkSchemaArtifactControlSessionStarter,
      input: RunFrameworkSchemaArtifactControlInput,
      work: FrameworkSchemaArtifactControlWork<Value, Failure>,
    ): Effect.Effect<
      FrameworkSchemaArtifactControlResult<Value>,
      | Failure
      | FrameworkSchemaArtifactControlSessionResourceIssue
      | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
      never
    > =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const terminal = yield* Effect.exit(
            runControlLifecycle(starter, input, work, restore),
          );
          const pending = yield* Effect.exit(restore(Effect.void));

          if (Exit.isFailure(pending)) {
            if (Exit.isSuccess(terminal)) {
              return yield* Effect.failCause(pending.cause);
            }
            const recordedInterruptors = new Set(
              terminal.cause.reasons
                .filter(Cause.isInterruptReason)
                .map((reason) => reason.fiberId),
            );
            const newPendingReasons = pending.cause.reasons.filter(
              (reason) =>
                !Cause.isInterruptReason(reason) ||
                !recordedInterruptors.has(reason.fiberId),
            );
            return yield* Effect.failCause(
              newPendingReasons.length === 0
                ? terminal.cause
                : Cause.combine(
                    terminal.cause,
                    Cause.fromReasons(newPendingReasons),
                  ),
            );
          }
          if (Exit.isFailure(terminal)) {
            return yield* Effect.failCause(terminal.cause);
          }
          return terminal.value;
        }),
      ),
  );

const runControlLifecycle = Effect.fn(
  "FrameworkSchemaArtifactControlSession.lifecycle",
)(function* <Value, Failure>(
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
    (transaction) =>
      withIssuedControlSessionTransactionEffect(
        starter,
        transaction,
        (controlTransaction) =>
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
      return yield* Effect.failCause(
        Cause.combine(initial.callbackCause, initial.cleanupCause),
      );
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
      return Effect.succeed(
        Object.freeze({
          status: "created",
          value: decision.value,
        }),
      );
    case "existing":
      return Effect.succeed(
        Object.freeze({
          status: "existing",
          value: decision.value,
        }),
      );
    case "resolveExisting":
      return driver
        .runReadEffect({ deadline }, work.resolveExistingEffect)
        .pipe(
          Effect.map((value) =>
            Object.freeze({
              status: "existing" as const,
              value,
            }),
          ),
        );
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
    > =>
      Effect.suspend(
        (): Effect.Effect<
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
            return driver
              .runReadEffect(
                { deadline: initial.recoveryDeadline },
                work.resolveExistingEffect,
              )
              .pipe(
                Effect.map((value) =>
                  Object.freeze({
                    status: "existing" as const,
                    value,
                  }),
                ),
              );
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
        },
      ),
  );
}

const runRecovery = Effect.fn(
  "FrameworkSchemaArtifactControlSession.runRecovery",
)(function* <Value, Failure>(
  starter: FrameworkSchemaArtifactControlSessionStarter,
  driver: FrameworkSchemaArtifactControlSessionDriver,
  deadline: FrameworkSchemaArtifactControlDeadline,
  excludedConnectionIdentity: FrameworkSchemaArtifactControlConnectionIdentity,
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
    (transaction) =>
      withIssuedControlSessionTransactionEffect(
        starter,
        transaction,
        (controlTransaction) =>
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
      const resolution = yield* Effect.exit(
        driver.runReadEffect({ deadline }, work.resolveExistingEffect),
      );
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
      Effect.ensuring(
        Effect.sync(() => {
          state.active = false;
        }),
      ),
    );
  });
}

const requireDeadlineKind = physicalDeadlines.requireKind;

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
  return Effect.flatMap(requireDeadlineKind(input.deadline, deadlineKind), () =>
    Effect.flatMap(starterStateEffect(starter), (state) =>
      state.driver.runReadEffect(input, work),
    ),
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
  const issue = new FrameworkSchemaArtifactControlSessionDecisionUncertainIssue(
    {
      stage,
      initialSettlementCause,
      resolutionCause,
    },
  );
  const typedCause = Cause.fail(issue);
  return Effect.failCause(
    operationalCause === undefined
      ? typedCause
      : Cause.combine(
          typedCause,
          Cause.map(operationalCause, () => issue),
        ),
  );
}
