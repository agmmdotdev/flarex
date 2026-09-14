import {
  makePhysicalDeadlineOperations,
  type PhysicalDeadline,
} from "./physicalSession/deadline";
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
} from "./physicalSession/model";
import { Cause, Data, Effect, Exit } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";

const catalogControlSessionStarterBrand: unique symbol = Symbol(
  "FlarexDB/CatalogControlSessionStarter",
);
const catalogControlSessionTransactionBrand: unique symbol =
  Symbol("FlarexDB/CatalogControlSessionTransaction");

export type CatalogControlDeadlineKind = PhysicalDeadlineKind;
export type CatalogControlSessionPhase = PhysicalSessionPhase;
export class CatalogControlSessionDeadlineIssue extends Data.TaggedError(
  "CatalogControlSessionDeadlineIssue",
)<{
  readonly deadlineKind: CatalogControlDeadlineKind;
  readonly phase: CatalogControlSessionPhase;
}> {}

export class CatalogControlSessionResourceIssue extends Data.TaggedError(
  "CatalogControlSessionResourceIssue",
)<{
  readonly phase: CatalogControlSessionPhase;
  readonly cause: unknown;
  readonly cleanupCause?: unknown;
}> {}

export class CatalogControlSessionDecisionUncertainIssue extends Data.TaggedError(
  "CatalogControlSessionDecisionUncertainIssue",
)<{
  readonly stage: "settle" | "recover";
  readonly initialSettlementCause: unknown;
  readonly resolutionCause: unknown;
}> {}

export class CatalogControlSessionCleanupDefect extends Data.TaggedError(
  "CatalogControlSessionCleanupDefect",
)<{
  readonly phase: "rollback" | "release" | "quarantine";
  readonly cause: unknown;
}> {}

export class CatalogControlSessionInvariantDefect extends Data.TaggedError(
  "CatalogControlSessionInvariantDefect",
)<{
  readonly reason:
    | "invalidStarter"
    | "invalidDeadline"
    | "invalidDeadlineDuration"
    | "invalidTransaction"
    | "crossStarterTransaction"
    | "closedTransaction";
}> {}

export interface CatalogControlSessionStarter {
  readonly [catalogControlSessionStarterBrand]: true;
}

export type CatalogControlDeadline = PhysicalDeadline;
export type CatalogControlConnectionIdentity =
  PhysicalConnectionIdentity;

/** Opaque transaction capability issued only for one active driver callback. */
export interface CatalogControlSessionTransaction {
  readonly [catalogControlSessionTransactionBrand]: true;
}

export type CatalogControlDecision<Value> =
  | Readonly<{ readonly kind: "created"; readonly value: Value }>
  | Readonly<{ readonly kind: "existing"; readonly value: Value }>
  | Readonly<{ readonly kind: "resolveExisting" }>;

export interface CatalogControlResult<Value> {
  readonly status: "created" | "existing";
  readonly value: Value;
}

export type CatalogControlSessionQuarantine =
  PhysicalSessionQuarantine;
export type CatalogControlInitialSettlement<Value, Failure> =
  PhysicalInitialSettlement<
    Value,
    Failure,
    CatalogControlSessionResourceIssue
  >;
export type CatalogControlRecoveryResolution<Failure> =
  PhysicalRecoveryResolution<
    Failure,
    CatalogControlSessionResourceIssue
  >;
export type CatalogControlRecoverySettlement<Value, Failure> =
  PhysicalRecoverySettlement<
    Value,
    Failure,
    CatalogControlSessionResourceIssue
  >;
export type CatalogControlReadInput = PhysicalReadInput;
export type CatalogControlRestore = PhysicalRestore;
export type CatalogControlInitialTransactionInput =
  PhysicalInitialTransactionInput;
export type CatalogControlRecoveryTransactionInput =
  PhysicalRecoveryTransactionInput;
export type CatalogControlSessionDriver =
  PhysicalSessionDriver<CatalogControlSessionResourceIssue>;

export interface MakeCatalogControlSessionStarterInput {
  readonly controlDb: FlarexMetadataDatabase;
  readonly driver: CatalogControlSessionDriver;
}

export interface CatalogControlWork<Value, Failure> {
  readonly runLockedEffect: (
    transaction: CatalogControlSessionTransaction,
    attempt: "initial" | "recovery",
  ) => Effect.Effect<
    CatalogControlDecision<Value>,
    Failure,
    never
  >;
  readonly resolveExistingEffect: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<
    Value,
    Failure | CatalogControlSessionResourceIssue,
    never
  >;
}

export interface RunCatalogControlInput {
  readonly initialDeadline: CatalogControlDeadline;
  readonly lockTimeoutMilliseconds: number;
  readonly recoveryTimeoutMilliseconds: number;
}

interface CatalogControlSessionStarterState {
  readonly controlDb: FlarexMetadataDatabase;
  readonly driver: CatalogControlSessionDriver;
}

interface CatalogControlSessionTransactionState {
  readonly starter: CatalogControlSessionStarter;
  readonly rawTransaction: FlarexMetadataTransaction;
  active: boolean;
}

const starterStates = new WeakMap<
  object,
  CatalogControlSessionStarterState
>();
const transactionStates = new WeakMap<
  object,
  CatalogControlSessionTransactionState
>();

/** Issue one opaque starter bound to one exact control database and driver. */
export function makeCatalogControlSessionStarter(
  input: MakeCatalogControlSessionStarterInput,
): CatalogControlSessionStarter {
  const starter = Object.freeze({
    [catalogControlSessionStarterBrand]: true,
  } satisfies CatalogControlSessionStarter);
  starterStates.set(
    starter,
    Object.freeze({
      controlDb: input.controlDb,
      driver: input.driver,
    } satisfies CatalogControlSessionStarterState),
  );
  return starter;
}

export { makePhysicalConnectionIdentity as makeCatalogControlConnectionIdentity } from "./physicalSession/model";

/**
 * Authenticate one active callback capability before repository code can bind
 * the underlying raw transaction to its own narrower token.
 */
export function withCatalogRawControlSessionTransactionEffect<
  Value,
  Failure,
>(
  transaction: CatalogControlSessionTransaction,
  expectedStarter: CatalogControlSessionStarter,
  work: (
    rawTransaction: FlarexMetadataTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<Value, Failure, never> {
  return Effect.suspend(() => {
    const state = transactionStates.get(transaction);
    if (state === undefined) {
      return Effect.die(
        new CatalogControlSessionInvariantDefect({
          reason: "invalidTransaction",
        }),
      );
    }
    if (!state.active) {
      return Effect.die(
        new CatalogControlSessionInvariantDefect({
          reason: "closedTransaction",
        }),
      );
    }
    if (state.starter !== expectedStarter) {
      return Effect.die(
        new CatalogControlSessionInvariantDefect({
          reason: "crossStarterTransaction",
        }),
      );
    }
    return work(state.rawTransaction);
  });
}

/** Authenticate the exact starter/control-database pair without property reads. */
export function hasCatalogControlSessionComposition(
  starter: unknown,
  controlDb: FlarexMetadataDatabase,
): starter is CatalogControlSessionStarter {
  if (typeof starter !== "object" || starter === null) return false;
  return starterStates.get(starter)?.controlDb === controlDb;
}

/** Artifact error identity is projected at emission; physical mechanics stay neutral. */
export const catalogControlPhysicalErrors: PhysicalSessionErrors<
  CatalogControlSessionResourceIssue,
  CatalogControlSessionDeadlineIssue
> = {
  resource: (fields) =>
    new CatalogControlSessionResourceIssue(fields),
  deadline: (fields) =>
    new CatalogControlSessionDeadlineIssue(fields),
  invariant: (fields) =>
    new CatalogControlSessionInvariantDefect(fields),
  cleanup: (fields) =>
    new CatalogControlSessionCleanupDefect(fields),
};
const physicalDeadlines = makePhysicalDeadlineOperations(
  catalogControlPhysicalErrors,
);
export const startCatalogControlDeadline =
  physicalDeadlines.start;
export const remainingCatalogControlMilliseconds =
  physicalDeadlines.remaining;
export const failCatalogControlDeadline =
  physicalDeadlines.fail;

/** Run one bounded read through the starter-owned connection adapter. */
export function runCatalogControlReadEffect<Value, Failure>(
  starter: CatalogControlSessionStarter,
  input: CatalogControlReadInput,
  work: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | CatalogControlSessionResourceIssue,
  never
> {
  return runControlReadEffect(starter, input, "read", work);
}

/** Run the optimistic admission read under its enclosing initial deadline. */
export function runCatalogControlInitialReadEffect<
  Value,
  Failure,
>(
  starter: CatalogControlSessionStarter,
  input: CatalogControlReadInput,
  work: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | CatalogControlSessionResourceIssue,
  never
> {
  return runControlReadEffect(starter, input, "initial", work);
}

export type RunCatalogControl = <Value, Failure>(
  starter: CatalogControlSessionStarter,
  input: RunCatalogControlInput,
  work: CatalogControlWork<Value, Failure>,
) => Effect.Effect<
  CatalogControlResult<Value>,
  | Failure
  | CatalogControlSessionResourceIssue
  | CatalogControlSessionDecisionUncertainIssue,
  never
>;

/**
 * Own one initial attempt and, only after confirmed quarantine, at most one
 * recovery attempt. The raw transaction is supplied only to the repository's
 * closure; repository code must immediately replace it with its scoped token.
 */
export const runCatalogControlEffect: RunCatalogControl =
  Effect.fn("CatalogControlSession.run")(
    <Value, Failure>(
      starter: CatalogControlSessionStarter,
      input: RunCatalogControlInput,
      work: CatalogControlWork<Value, Failure>,
    ): Effect.Effect<
      CatalogControlResult<Value>,
      | Failure
      | CatalogControlSessionResourceIssue
      | CatalogControlSessionDecisionUncertainIssue,
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
  "CatalogControlSession.lifecycle",
)(function* <Value, Failure>(
  starter: CatalogControlSessionStarter,
  input: RunCatalogControlInput,
  work: CatalogControlWork<Value, Failure>,
  restore: CatalogControlRestore,
): Effect.fn.Return<
  CatalogControlResult<Value>,
  | Failure
  | CatalogControlSessionResourceIssue
  | CatalogControlSessionDecisionUncertainIssue
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
  driver: CatalogControlSessionDriver,
  decision: CatalogControlDecision<Value>,
  deadline: CatalogControlDeadline,
  work: CatalogControlWork<Value, Failure>,
): Effect.Effect<
  CatalogControlResult<Value>,
  Failure | CatalogControlSessionResourceIssue,
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
  starter: CatalogControlSessionStarter,
  driver: CatalogControlSessionDriver,
  initial: Extract<
    CatalogControlInitialSettlement<
      CatalogControlDecision<Value>,
      Failure
    >,
    { readonly kind: "uncertain" }
  >,
  input: RunCatalogControlInput,
  work: CatalogControlWork<Value, Failure>,
): Effect.Effect<
  CatalogControlResult<Value>,
  | Failure
  | CatalogControlSessionResourceIssue
  | CatalogControlSessionDecisionUncertainIssue,
  never
> {
  return Effect.flatMap(
    requireDeadlineKind(initial.recoveryDeadline, "recovery"),
    (): Effect.Effect<
      CatalogControlResult<Value>,
      | Failure
      | CatalogControlSessionResourceIssue
      | CatalogControlSessionDecisionUncertainIssue,
      never
    > =>
      Effect.suspend(
        (): Effect.Effect<
          CatalogControlResult<Value>,
          | Failure
          | CatalogControlSessionResourceIssue
          | CatalogControlSessionDecisionUncertainIssue,
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
  "CatalogControlSession.runRecovery",
)(function* <Value, Failure>(
  starter: CatalogControlSessionStarter,
  driver: CatalogControlSessionDriver,
  deadline: CatalogControlDeadline,
  excludedConnectionIdentity: CatalogControlConnectionIdentity,
  initialSettlementCause: unknown,
  lockTimeoutMilliseconds: number,
  work: CatalogControlWork<Value, Failure>,
): Effect.fn.Return<
  CatalogControlResult<Value>,
  CatalogControlSessionDecisionUncertainIssue
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
  starter: CatalogControlSessionStarter,
  rawTransaction: FlarexMetadataTransaction,
  work: (
    transaction: CatalogControlSessionTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<Value, Failure, never> {
  return Effect.suspend(() => {
    const state: CatalogControlSessionTransactionState = {
      starter,
      rawTransaction,
      active: true,
    };
    const transaction = Object.freeze({
      [catalogControlSessionTransactionBrand]: true,
    } satisfies CatalogControlSessionTransaction);
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
  starter: CatalogControlSessionStarter,
): Effect.Effect<
  CatalogControlSessionStarterState,
  never,
  never
> {
  const state = starterStates.get(starter);
  return state === undefined
    ? Effect.die(
        new CatalogControlSessionInvariantDefect({
          reason: "invalidStarter",
        }),
      )
    : Effect.succeed(state);
}

function runControlReadEffect<Value, Failure>(
  starter: CatalogControlSessionStarter,
  input: CatalogControlReadInput,
  deadlineKind: Extract<
    CatalogControlDeadlineKind,
    "read" | "initial"
  >,
  work: (
    database: FlarexMetadataDatabase,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | CatalogControlSessionResourceIssue,
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
  CatalogControlSessionDecisionUncertainIssue,
  never
> {
  const issue = new CatalogControlSessionDecisionUncertainIssue(
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
