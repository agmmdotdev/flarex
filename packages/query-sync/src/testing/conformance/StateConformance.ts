import { Clock, Effect, Result } from "effect";

import { capturePublicationAttemptInstant } from "../../kernel/CanonicalValue.js";
import type {
  PublicationAttemptInstant,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../../kernel/CanonicalValue.js";
import {
  claimEvaluationWork,
  recordEvaluationAttemptOutcome,
} from "../../kernel/EvaluationWork.js";
import type {
  ClaimEvaluationWorkError,
  EvaluationAttemptOutcome,
  EvaluationWorkScanRequest,
  RecordEvaluationAttemptOutcomeError,
} from "../../kernel/EvaluationWork.js";
import { QuerySyncInvariantDefect } from "../../kernel/Errors.js";
import type {
  AdmittedInvalidationBatch,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QuerySyncState,
} from "../../kernel/Model.js";
import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
} from "../../kernel/Policy.js";
import type {
  ApplyInvalidationsError,
  BeginQueryEvaluationError,
  CompleteQueryEvaluationError,
} from "../../kernel/Policy.js";
import type {
  QueryPublicationArtifact,
} from "../../kernel/Publication.js";
import {
  claimPublication,
  completePublication,
  recordPublicationAttemptOutcome,
} from "../../kernel/PublicationWork.js";
import type {
  AcceptedQueryPublicationEvidence,
  ClaimPublicationError,
  CompletePublicationError,
  PublicationAttempt,
  PublicationAttemptOutcome,
  RecordPublicationAttemptOutcomeError,
} from "../../kernel/PublicationWork.js";
import {
  QuerySyncStoredStateCorruptError,
} from "../../state/Errors.js";
import type {
  QuerySyncStateIntegrationError,
  QuerySyncStateOperation,
} from "../../state/Errors.js";
import type { QuerySyncTransitionState } from "../../state/Port.js";
import {
  applyInitializeNamespaceTransition,
} from "../../state/Initialization.js";
import {
  projectApplyReceipt,
  projectBeginReceipt,
  projectClaimEvaluationWorkReceipt,
  projectClaimPublicationReceipt,
  projectCompleteReceipt,
  projectCompletePublicationReceipt,
  projectRecordEvaluationAttemptOutcomeReceipt,
  projectRecordPublicationAttemptOutcomeReceipt,
} from "../../state/Receipts.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  ClaimEvaluationWorkReceipt,
  ClaimPublicationReceipt,
  CompleteQueryEvaluationReceipt,
  CompletePublicationReceipt,
  InitializeNamespaceReceipt,
  RecordEvaluationAttemptOutcomeReceipt,
  RecordPublicationAttemptOutcomeReceipt,
} from "../../state/Receipts.js";

export type StateConformanceCommand =
  | Readonly<{
    readonly _tag: "initializeOrInspectNamespace";
    readonly bootstrapCursor: NamespaceCursor;
  }>
  | Readonly<{
    readonly _tag: "beginQueryEvaluation";
    readonly request: BeginQueryEvaluationRequest;
  }>
  | Readonly<{
    readonly _tag: "applyAdmittedBatchAndAdvance";
    readonly batch: AdmittedInvalidationBatch;
  }>
  | Readonly<{
    readonly _tag: "completeQueryEvaluation";
    readonly attempt: QueryEvaluationAttempt;
    readonly evaluation: QueryEvaluationEvidence;
    readonly refresh: GenerationRefreshEvidence;
    readonly publication: QueryPublicationArtifact;
  }>
  | Readonly<{
    readonly _tag: "claimEvaluationWork";
    readonly request: EvaluationWorkScanRequest;
  }>
  | Readonly<{
    readonly _tag: "recordEvaluationAttemptOutcome";
    readonly attempt: QueryEvaluationAttempt;
    readonly outcome: EvaluationAttemptOutcome;
  }>
  | Readonly<{
    readonly _tag: "claimPublication";
  }>
  | Readonly<{
    readonly _tag: "recordPublicationAttemptOutcome";
    readonly attempt: PublicationAttempt;
    readonly outcome: PublicationAttemptOutcome;
  }>
  | Readonly<{
    readonly _tag: "completePublication";
    readonly evidence: AcceptedQueryPublicationEvidence;
  }>;

export type StateConformanceReceipt =
  | InitializeNamespaceReceipt
  | BeginQueryEvaluationReceipt
  | ApplyAdmittedBatchReceipt
  | CompleteQueryEvaluationReceipt
  | ClaimEvaluationWorkReceipt
  | RecordEvaluationAttemptOutcomeReceipt
  | ClaimPublicationReceipt
  | RecordPublicationAttemptOutcomeReceipt
  | CompletePublicationReceipt;

export interface StateConformanceBinding {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
}

/**
 * Testing capability implemented by any state adapter that wants to run the
 * shared reducer-versus-port conformance history. This remains outside the
 * production state port because direct aggregate reads are not runtime API.
 */
export interface QuerySyncStateConformanceTarget<SnapshotError = never>
  extends QuerySyncTransitionState {
  readonly bindingForConformance: StateConformanceBinding;
  readonly snapshotForConformance: () => Effect.Effect<
    QuerySyncState | null,
    SnapshotError,
    never
  >;
}

export interface StateConformanceRun {
  readonly initialExpectedState: QuerySyncState | null;
  readonly commands: readonly StateConformanceCommand[];
}

export interface StateConformanceStep {
  readonly command: StateConformanceCommand["_tag"];
  readonly outcome: Result.Result<
    StateConformanceReceipt,
    StateConformanceError
  >;
  readonly expectedOutcome: Result.Result<
    StateConformanceReceipt,
    StateConformanceError
  >;
  readonly snapshot: QuerySyncState | null;
  readonly expectedSnapshot: QuerySyncState | null;
}

export type StateConformanceError =
  | BuildQuerySyncStateError
  | BeginQueryEvaluationError
  | ApplyInvalidationsError
  | CompleteQueryEvaluationError
  | ClaimEvaluationWorkError
  | RecordEvaluationAttemptOutcomeError
  | ClaimPublicationError
  | RecordPublicationAttemptOutcomeError
  | CompletePublicationError
  | QuerySyncStateIntegrationError;

interface OracleTransition {
  readonly receipt: StateConformanceReceipt;
  readonly nextState: QuerySyncState;
}

function corruptState<Operation extends QuerySyncStateOperation>(
  operation: Operation,
  reason: "aggregateMissing" | "namespaceBindingMismatch",
): QuerySyncStoredStateCorruptError<Operation> {
  return new QuerySyncStoredStateCorruptError<Operation>({
    operation,
    commitCertainty: "notCommitted",
    reason,
    cause: null,
  });
}

function transitionState<Operation extends Exclude<
  QuerySyncStateOperation,
  "initializeOrInspectNamespace"
>>(
  current: QuerySyncState | null,
  binding: StateConformanceBinding,
  operation: Operation,
): Result.Result<QuerySyncState, QuerySyncStoredStateCorruptError<Operation>> {
  if (current === null) {
    return Result.fail(corruptState(operation, "aggregateMissing"));
  }
  if (
    current.cursor.namespaceId !== binding.namespaceId
    || current.cursor.syncModelId !== binding.syncModelId
    || current.cursor.sourceEpoch !== binding.sourceEpoch
  ) {
    return Result.fail(corruptState(operation, "namespaceBindingMismatch"));
  }
  return Result.succeed(current);
}

function reduceOracleCommand(
  current: QuerySyncState | null,
  wasPreviouslyInitialized: boolean,
  binding: StateConformanceBinding,
  command: StateConformanceCommand,
  capturedNow: PublicationAttemptInstant | null,
): Result.Result<OracleTransition, StateConformanceError> {
  switch (command._tag) {
    case "initializeOrInspectNamespace":
      return applyInitializeNamespaceTransition({
        current,
        wasPreviouslyInitialized,
        binding,
        bootstrapCursor: command.bootstrapCursor,
      });
    case "beginQueryEvaluation":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "beginQueryEvaluation",
        );
        const decision = yield* beginQueryEvaluation(state, command.request);
        return Object.freeze({
          receipt: projectBeginReceipt(decision),
          nextState: decision.state,
        });
      });
    case "applyAdmittedBatchAndAdvance":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "applyAdmittedBatchAndAdvance",
        );
        const decision = yield* applyAdmittedInvalidations(
          state,
          command.batch,
        );
        return Object.freeze({
          receipt: projectApplyReceipt(decision),
          nextState: decision.state,
        });
      });
    case "completeQueryEvaluation":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "completeQueryEvaluation",
        );
        const decision = yield* completeQueryEvaluation(
          state,
          command.attempt,
          command.evaluation,
          command.refresh,
          command.publication,
        );
        return Object.freeze({
          receipt: projectCompleteReceipt(decision),
          nextState: decision.state,
        });
      });
    case "claimEvaluationWork":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "claimEvaluationWork",
        );
        const decision = yield* claimEvaluationWork(state, command.request);
        return Object.freeze({
          receipt: projectClaimEvaluationWorkReceipt(decision),
          nextState: decision.state,
        });
      });
    case "recordEvaluationAttemptOutcome":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "recordEvaluationAttemptOutcome",
        );
        const decision = yield* recordEvaluationAttemptOutcome(
          state,
          command.attempt,
          command.outcome,
        );
        return Object.freeze({
          receipt: projectRecordEvaluationAttemptOutcomeReceipt(decision),
          nextState: decision.state,
        });
      });
    case "claimPublication":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "claimPublication",
        );
        if (capturedNow === null) {
          throw new QuerySyncInvariantDefect({
            operation: "claimPublication",
            invariant: "stateClockInstantInvalid",
          });
        }
        const decision = yield* claimPublication(state, capturedNow);
        return Object.freeze({
          receipt: projectClaimPublicationReceipt(decision),
          nextState: decision.state,
        });
      });
    case "recordPublicationAttemptOutcome":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "recordPublicationAttemptOutcome",
        );
        if (capturedNow === null) {
          throw new QuerySyncInvariantDefect({
            operation: "recordPublicationAttemptOutcome",
            invariant: "stateClockInstantInvalid",
          });
        }
        const decision = yield* recordPublicationAttemptOutcome(
          state,
          command.attempt,
          command.outcome,
          capturedNow,
        );
        return Object.freeze({
          receipt: projectRecordPublicationAttemptOutcomeReceipt(decision),
          nextState: decision.state,
        });
      });
    case "completePublication":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "completePublication",
        );
        const decision = yield* completePublication(state, command.evidence);
        return Object.freeze({
          receipt: projectCompletePublicationReceipt(decision),
          nextState: decision.state,
        });
      });
  }
}

function executeTargetCommand(
  target: QuerySyncTransitionState,
  command: StateConformanceCommand,
): Effect.Effect<
  StateConformanceReceipt,
  StateConformanceError,
  never
> {
  switch (command._tag) {
    case "initializeOrInspectNamespace":
      return target.initializeOrInspectNamespace(command.bootstrapCursor);
    case "beginQueryEvaluation":
      return target.beginQueryEvaluation(command.request);
    case "applyAdmittedBatchAndAdvance":
      return target.applyAdmittedBatchAndAdvance(command.batch);
    case "completeQueryEvaluation":
      return target.completeQueryEvaluation(
        command.attempt,
        command.evaluation,
        command.refresh,
        command.publication,
      );
    case "claimEvaluationWork":
      return target.claimEvaluationWork(command.request);
    case "recordEvaluationAttemptOutcome":
      return target.recordEvaluationAttemptOutcome(
        command.attempt,
        command.outcome,
      );
    case "claimPublication":
      return target.claimPublication();
    case "recordPublicationAttemptOutcome":
      return target.recordPublicationAttemptOutcome(
        command.attempt,
        command.outcome,
      );
    case "completePublication":
      return target.completePublication(command.evidence);
  }
}

function isClockedPublicationCommand(
  command: StateConformanceCommand,
): command is Extract<
  StateConformanceCommand,
  { readonly _tag: "claimPublication" | "recordPublicationAttemptOutcome" }
> {
  return command._tag === "claimPublication"
    || command._tag === "recordPublicationAttemptOutcome";
}

const captureConformanceClockInstant = Effect.fn(
  "QuerySync.StateConformance.captureClockInstant",
)(function*(
  operation: "claimPublication" | "recordPublicationAttemptOutcome",
): Effect.fn.Return<PublicationAttemptInstant> {
  const observedNow = yield* Clock.currentTimeMillis;
  return yield* Result.match(capturePublicationAttemptInstant(observedNow), {
    onFailure: () => Effect.die(new QuerySyncInvariantDefect({
      operation,
      invariant: "stateClockInstantInvalid",
    })),
    onSuccess: Effect.succeed,
  });
});

export const runStateConformanceCommands = Effect.fn(
  "QuerySync.StateConformance.runCommands",
)(function*<SnapshotError>(
  target: QuerySyncStateConformanceTarget<SnapshotError>,
  run: StateConformanceRun,
): Effect.fn.Return<
  readonly StateConformanceStep[],
  SnapshotError,
  never
> {
  const steps: StateConformanceStep[] = [];
  let expectedState = run.initialExpectedState;
  let expectedWasPreviouslyInitialized = expectedState !== null;
  for (const command of run.commands) {
    const capturedNow = isClockedPublicationCommand(command)
      ? yield* captureConformanceClockInstant(command._tag)
      : null;
    const expectedTransition = reduceOracleCommand(
      expectedState,
      expectedWasPreviouslyInitialized,
      target.bindingForConformance,
      command,
      capturedNow,
    );
    const expectedOutcome = Result.map(
      expectedTransition,
      (transition) => transition.receipt,
    );
    const nextExpectedState = Result.match(expectedTransition, {
      onFailure: () => expectedState,
      onSuccess: (transition) => transition.nextState,
    });
    const outcome = yield* Effect.result(executeTargetCommand(
      target,
      command,
    ));
    const snapshot = yield* target.snapshotForConformance();
    steps.push(Object.freeze({
      command: command._tag,
      outcome,
      expectedOutcome,
      snapshot,
      expectedSnapshot: nextExpectedState,
    }));
    expectedState = nextExpectedState;
    if (nextExpectedState !== null) {
      expectedWasPreviouslyInitialized = true;
    }
  }
  return Object.freeze(steps);
});
