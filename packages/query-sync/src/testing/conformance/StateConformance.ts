import { Effect, Result } from "effect";

import type {
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../../kernel/CanonicalValue.js";
import {
  createEmptyQuerySyncState,
} from "../../kernel/Model.js";
import type {
  AdmittedInvalidationBatch,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QueryOperationTarget,
  QuerySyncState,
} from "../../kernel/Model.js";
import {
  applyAdmittedInvalidations,
  beginQueryGeneration,
  completeQueryGeneration,
} from "../../kernel/Policy.js";
import type {
  ApplyInvalidationsError,
  BeginQueryGenerationError,
  CompleteQueryGenerationError,
} from "../../kernel/Policy.js";
import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "../../state/Errors.js";
import type {
  QuerySyncStateIntegrationError,
  QuerySyncStateOperation,
} from "../../state/Errors.js";
import type { QuerySyncTransitionState } from "../../state/Port.js";
import {
  epochReplacedReceipt,
  initializedNamespaceReceipt,
  modelReplacedReceipt,
  projectApplyReceipt,
  projectBeginReceipt,
  projectCompleteReceipt,
} from "../../state/Receipts.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryGenerationReceipt,
  CompleteQueryGenerationReceipt,
  InitializeNamespaceReceipt,
} from "../../state/Receipts.js";

export type StateConformanceCommand =
  | Readonly<{
    readonly _tag: "initializeOrInspectNamespace";
    readonly bootstrapCursor: NamespaceCursor;
  }>
  | Readonly<{
    readonly _tag: "beginQueryGeneration";
    readonly target: QueryOperationTarget;
  }>
  | Readonly<{
    readonly _tag: "applyAdmittedBatchAndAdvance";
    readonly batch: AdmittedInvalidationBatch;
  }>
  | Readonly<{
    readonly _tag: "completeQueryGeneration";
    readonly evaluation: QueryEvaluationEvidence;
    readonly refresh: GenerationRefreshEvidence;
  }>;

export type StateConformanceReceipt =
  | InitializeNamespaceReceipt
  | BeginQueryGenerationReceipt
  | ApplyAdmittedBatchReceipt
  | CompleteQueryGenerationReceipt;

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
  | BeginQueryGenerationError
  | ApplyInvalidationsError
  | CompleteQueryGenerationError
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

function initializeOracle(
  current: QuerySyncState | null,
  binding: StateConformanceBinding,
  bootstrapCursor: NamespaceCursor,
): Result.Result<
  OracleTransition,
  | BuildQuerySyncStateError
  | QuerySyncStateIntegrationError<"initializeOrInspectNamespace">
> {
  return Result.gen(function* () {
    if (
      bootstrapCursor.namespaceId !== binding.namespaceId
      || bootstrapCursor.syncModelId !== binding.syncModelId
      || bootstrapCursor.sourceEpoch !== binding.sourceEpoch
    ) {
      return yield* Result.fail(new QuerySyncStoredStateIncompatibleError<
        "initializeOrInspectNamespace"
      >({
        operation: "initializeOrInspectNamespace",
        commitCertainty: "notCommitted",
        reason: "bootstrapBindingMismatch",
        cause: null,
      }));
    }
    if (current === null) {
      const nextState = yield* createEmptyQuerySyncState(bootstrapCursor);
      return Object.freeze({
        receipt: initializedNamespaceReceipt(
          "initialized",
          nextState.cursor,
          nextState.metrics,
        ),
        nextState,
      });
    }
    if (current.cursor.namespaceId !== binding.namespaceId) {
      return yield* Result.fail(corruptState(
        "initializeOrInspectNamespace",
        "namespaceBindingMismatch",
      ));
    }
    if (current.cursor.syncModelId !== binding.syncModelId) {
      return Object.freeze({
        receipt: modelReplacedReceipt(
          current.cursor,
          binding.syncModelId,
        ),
        nextState: current,
      });
    }
    if (current.cursor.sourceEpoch !== binding.sourceEpoch) {
      return Object.freeze({
        receipt: epochReplacedReceipt(
          current.cursor,
          binding.sourceEpoch,
        ),
        nextState: current,
      });
    }
    return Object.freeze({
      receipt: initializedNamespaceReceipt(
        "existing",
        current.cursor,
        current.metrics,
      ),
      nextState: current,
    });
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
  binding: StateConformanceBinding,
  command: StateConformanceCommand,
): Result.Result<OracleTransition, StateConformanceError> {
  switch (command._tag) {
    case "initializeOrInspectNamespace":
      return initializeOracle(current, binding, command.bootstrapCursor);
    case "beginQueryGeneration":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "beginQueryGeneration",
        );
        const decision = yield* beginQueryGeneration(state, command.target);
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
    case "completeQueryGeneration":
      return Result.gen(function* () {
        const state = yield* transitionState(
          current,
          binding,
          "completeQueryGeneration",
        );
        const decision = yield* completeQueryGeneration(
          state,
          command.evaluation,
          command.refresh,
        );
        return Object.freeze({
          receipt: projectCompleteReceipt(decision),
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
    case "beginQueryGeneration":
      return target.beginQueryGeneration(command.target);
    case "applyAdmittedBatchAndAdvance":
      return target.applyAdmittedBatchAndAdvance(command.batch);
    case "completeQueryGeneration":
      return target.completeQueryGeneration(
        command.evaluation,
        command.refresh,
      );
  }
}

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
  for (const command of run.commands) {
    const expectedTransition = reduceOracleCommand(
      expectedState,
      target.bindingForConformance,
      command,
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
  }
  return Object.freeze(steps);
});
