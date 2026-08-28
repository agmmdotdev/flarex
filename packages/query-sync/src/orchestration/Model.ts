import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { Result } from "effect";

import type {
  ChangeBudgetInsufficient,
  ChangeSourceEpochReplaced,
  ChangeSourceHistoryUnavailable,
  CaughtUpChangeAuthority,
} from "../change/Model.js";
import type {
  BlockedEvaluationWorkEvidence,
  EvaluationWorkScanContinuation,
} from "../kernel/EvaluationWork.js";
import type {
  NamespaceCursor,
  QueryDescriptor,
} from "../kernel/Model.js";
import type {
  QueryCompletionPublicationDisposition,
} from "../kernel/Publication.js";
import type {
  QueryGeneration,
  SyncEpoch,
  SyncModelId,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  InvalidNamespaceQuerySyncPolicyError,
  InvalidQuerySyncTurnBudgetError,
} from "./Errors.js";

export const MAX_TURN_SOURCE_READS = 32;
export const MAX_TURN_ADMITTED_BATCHES = 4_096;
export const MAX_TURN_SOURCE_TRANSPORT_BYTES = 16 * 1_024 * 1_024;
export const MAX_TURN_MODEL_SEMANTIC_WORK_UNITS = 65_536;
export const MAX_TURN_MODEL_SEMANTIC_BYTES = 16 * 1_024 * 1_024;
export const MAX_TURN_DEPENDENCY_KEY_EXAMINATIONS = 65_536;
export const MAX_TURN_CANONICAL_DEPENDENCY_BYTES = 16 * 1_024 * 1_024;
export const MAX_TURN_WINDOW_MILLISECONDS = 60_000;
export const MAX_TURN_EVALUATED_QUERIES = 32;
export const MAX_EVALUATOR_CALLS_PER_QUERY = 2;
export const MAX_STATE_ATTEMPTS_PER_OPERATION = 3;
export const MAX_SOURCE_ATTEMPTS_PER_READ = 3;
export const MAX_RETRY_DELAY_MILLISECONDS = 60_000;

export interface NamespaceQuerySyncPolicy {
  readonly stateAttemptsPerOperation: number;
  readonly sourceAttemptsPerRead: number;
  readonly retryDelayMilliseconds: readonly [number, number];
  readonly settlementReserveMilliseconds: number;
}

export interface CatchUpTurnBudget {
  readonly sourceReads: number;
  readonly admittedBatches: number;
  readonly sourceTransportBytes: number;
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
  readonly dependencyKeyExaminations: number;
  readonly canonicalDependencyBytes: number;
  readonly newWorkWindowMilliseconds: number;
}

export interface EvaluationTurnBudget extends CatchUpTurnBudget {
  readonly evaluatedQueries: number;
  readonly evaluatorCallsPerQuery: number;
}

export type QuerySyncTurnOperation =
  | "catchUp"
  | "beginQuery"
  | "runEvaluationWork";

export interface OrchestrationTurnProgress {
  readonly sourceCalls: number;
  readonly admittedBatches: number;
  readonly settledBatchTransitions: number;
  readonly sourceTransportBytes: number;
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
  readonly dependencyKeyExaminations: number;
  readonly canonicalDependencyBytes: number;
  readonly claimedEvaluationAttempts: number;
  readonly evaluatorCalls: number;
  readonly completedEvaluations: number;
  readonly replayedEvaluations: number;
  readonly supersededEvaluations: number;
  readonly recoveryEvidenceExpiredEvaluations: number;
  readonly blockedEvaluations: number;
  readonly lastDurableCursor: NamespaceCursor;
}

export interface OrchestrationTurnLedger {
  sourceCalls: number;
  admittedBatches: number;
  settledBatchTransitions: number;
  sourceTransportBytes: number;
  modelSemanticWorkUnits: number;
  modelSemanticBytes: number;
  dependencyKeyExaminations: number;
  canonicalDependencyBytes: number;
  claimedEvaluationAttempts: number;
  evaluatorCalls: number;
  completedEvaluations: number;
  replayedEvaluations: number;
  supersededEvaluations: number;
  recoveryEvidenceExpiredEvaluations: number;
  blockedEvaluations: number;
  lastDurableCursor: NamespaceCursor;
}

export type CatchUpContinuationReason =
  | "deadlineReached"
  | "sourceReadLimitReached"
  | "admittedBatchLimitReached"
  | "sourceTransportByteLimitReached"
  | "modelSemanticWorkLimitReached"
  | "modelSemanticByteLimitReached"
  | "dependencyKeyExaminationLimitReached"
  | "canonicalDependencyByteLimitReached";

export type EvaluationContinuationReason =
  | CatchUpContinuationReason
  | "evaluatedQueryLimitReached"
  | "evaluatorCallLimitReached"
  | "transientEvaluatorExhausted"
  | "refreshRequired"
  | "resnapshotRequired"
  | "rerunRequired"
  | "scanContinued"
  | "scanRestarted";

export type CatchUpPhase =
  | "initialCatchUp"
  | "postEvaluationCatchUp"
  | "refreshReplay";

export interface EvaluationTurnContinuation {
  readonly phase: CatchUpPhase | "evaluation";
  readonly reason: EvaluationContinuationReason;
  readonly scan: EvaluationWorkScanContinuation | null;
}

export type CatchUpBoundaryOutcome<
  Phase extends CatchUpPhase = CatchUpPhase,
> =
  | Readonly<{
    readonly _tag: "continuationRequired";
    readonly phase: Phase;
    readonly reason: CatchUpContinuationReason;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "budgetInsufficient";
    readonly phase: Phase;
    readonly evidence: ChangeBudgetInsufficient;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "historyUnavailable";
    readonly phase: Phase;
    readonly evidence: ChangeSourceHistoryUnavailable;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "modelReplaced";
    readonly phase: "initialCatchUp";
    readonly existingCursor: NamespaceCursor;
    readonly requestedSyncModelId: SyncModelId;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "epochReplaced";
    readonly phase: Phase;
    readonly evidence:
      | Readonly<{
        readonly source: "state";
        readonly existingCursor: NamespaceCursor;
        readonly requestedSourceEpoch: SyncEpoch;
      }>
      | Readonly<{
        readonly source: "changeSource";
        readonly value: ChangeSourceEpochReplaced;
      }>;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "gap";
    readonly phase: Phase;
    readonly expectedSequence: SyncSequence;
    readonly observedSequence: SyncSequence;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "resetRequired";
    readonly phase: Phase;
    readonly expectedSourceEpoch: SyncEpoch;
    readonly observedSourceEpoch: SyncEpoch;
    readonly progress: OrchestrationTurnProgress;
  }>;

export type CatchUpTurnOutcome =
  | Readonly<{
    readonly _tag: "caughtUp";
    readonly cursor: NamespaceCursor;
    readonly authority: CaughtUpChangeAuthority;
    readonly progress: OrchestrationTurnProgress;
  }>
  | CatchUpBoundaryOutcome<"initialCatchUp">;

export type EvaluationBoundaryOutcome =
  | Exclude<
    CatchUpBoundaryOutcome,
    { readonly _tag: "continuationRequired" }
  >
  | Readonly<{
    readonly _tag: "continuationRequired";
    readonly continuation: EvaluationTurnContinuation;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "evaluationBlocked";
    readonly blockedWork: BlockedEvaluationWorkEvidence;
    readonly continuation: null;
    readonly progress: OrchestrationTurnProgress;
  }>;

export type BeginQueryTurnOutcome =
  | Readonly<{
    readonly _tag: "completed" | "replayed";
    readonly generation: QueryGeneration;
    readonly publicationDisposition: QueryCompletionPublicationDisposition;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "alreadyActive";
    readonly descriptor: QueryDescriptor;
    readonly requestedExpectedActiveGeneration: null;
    readonly activeGeneration: QueryGeneration;
    readonly freshThroughSequence: SyncSequence;
    readonly progress: OrchestrationTurnProgress;
  }>
  | Readonly<{
    readonly _tag: "superseded" | "recoveryEvidenceExpired";
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
    readonly progress: OrchestrationTurnProgress;
  }>
  | EvaluationBoundaryOutcome;

export type EvaluationWorkTurnOutcome =
  | Readonly<{
    readonly _tag: "idle";
    readonly progress: OrchestrationTurnProgress;
  }>
  | EvaluationBoundaryOutcome;

function policyFailure(
  field: InvalidNamespaceQuerySyncPolicyError["field"],
  reason: InvalidNamespaceQuerySyncPolicyError["reason"],
): Result.Result<never, InvalidNamespaceQuerySyncPolicyError> {
  return Result.fail(new InvalidNamespaceQuerySyncPolicyError({
    operation: "makeNamespaceQuerySync",
    field,
    reason,
  }));
}

export function captureNamespaceQuerySyncPolicy(
  input: NamespaceQuerySyncPolicy,
): Result.Result<NamespaceQuerySyncPolicy, InvalidNamespaceQuerySyncPolicyError> {
  const stateAttemptsPerOperation = input.stateAttemptsPerOperation;
  if (!isPositiveSafeInteger(stateAttemptsPerOperation)) {
    return policyFailure("stateAttemptsPerOperation", "invalidValue");
  }
  if (stateAttemptsPerOperation > MAX_STATE_ATTEMPTS_PER_OPERATION) {
    return policyFailure("stateAttemptsPerOperation", "aboveHardMaximum");
  }

  const sourceAttemptsPerRead = input.sourceAttemptsPerRead;
  if (!isPositiveSafeInteger(sourceAttemptsPerRead)) {
    return policyFailure("sourceAttemptsPerRead", "invalidValue");
  }
  if (sourceAttemptsPerRead > MAX_SOURCE_ATTEMPTS_PER_READ) {
    return policyFailure("sourceAttemptsPerRead", "aboveHardMaximum");
  }

  const delays = input.retryDelayMilliseconds;
  if (!Array.isArray(delays) || delays.length !== 2) {
    return policyFailure("retryDelayMilliseconds", "invalidPair");
  }
  const firstDelay = delays[0];
  const secondDelay = delays[1];
  if (
    !isNonNegativeSafeInteger(firstDelay)
    || !isNonNegativeSafeInteger(secondDelay)
  ) {
    return policyFailure("retryDelayMilliseconds", "invalidPair");
  }
  if (
    firstDelay > MAX_RETRY_DELAY_MILLISECONDS
    || secondDelay > MAX_RETRY_DELAY_MILLISECONDS
  ) {
    return policyFailure("retryDelayMilliseconds", "aboveHardMaximum");
  }

  const settlementReserveMilliseconds =
    input.settlementReserveMilliseconds;
  if (!isPositiveSafeInteger(settlementReserveMilliseconds)) {
    return policyFailure("settlementReserveMilliseconds", "invalidValue");
  }
  if (settlementReserveMilliseconds >= MAX_TURN_WINDOW_MILLISECONDS) {
    return policyFailure(
      "settlementReserveMilliseconds",
      "aboveHardMaximum",
    );
  }

  const retryDelayMilliseconds: readonly [number, number] = Object.freeze([
    firstDelay,
    secondDelay,
  ]);
  return Result.succeed(Object.freeze({
    stateAttemptsPerOperation,
    sourceAttemptsPerRead,
    retryDelayMilliseconds,
    settlementReserveMilliseconds,
  }));
}

function budgetFailure(
  operation: QuerySyncTurnOperation,
  field: InvalidQuerySyncTurnBudgetError["field"],
  reason: InvalidQuerySyncTurnBudgetError["reason"],
  observed: number,
): Result.Result<never, InvalidQuerySyncTurnBudgetError> {
  return Result.fail(new InvalidQuerySyncTurnBudgetError({
    operation,
    field,
    reason,
    observed,
  }));
}

function captureCatchUpFields(
  operation: QuerySyncTurnOperation,
  input: CatchUpTurnBudget,
  settlementReserveMilliseconds: number,
): Result.Result<CatchUpTurnBudget, InvalidQuerySyncTurnBudgetError> {
  const captureField = (
    field: keyof CatchUpTurnBudget,
    observed: number,
    maximum: number,
  ): Result.Result<number, InvalidQuerySyncTurnBudgetError> => {
    if (!isPositiveSafeInteger(observed)) {
      return budgetFailure(operation, field, "invalidValue", observed);
    }
    if (observed > maximum) {
      return budgetFailure(operation, field, "aboveHardMaximum", observed);
    }
    return Result.succeed(observed);
  };
  return Result.gen(function* () {
    const sourceReads = yield* captureField(
      "sourceReads",
      input.sourceReads,
      MAX_TURN_SOURCE_READS,
    );
    const admittedBatches = yield* captureField(
      "admittedBatches",
      input.admittedBatches,
      MAX_TURN_ADMITTED_BATCHES,
    );
    const sourceTransportBytes = yield* captureField(
      "sourceTransportBytes",
      input.sourceTransportBytes,
      MAX_TURN_SOURCE_TRANSPORT_BYTES,
    );
    const modelSemanticWorkUnits = yield* captureField(
      "modelSemanticWorkUnits",
      input.modelSemanticWorkUnits,
      MAX_TURN_MODEL_SEMANTIC_WORK_UNITS,
    );
    const modelSemanticBytes = yield* captureField(
      "modelSemanticBytes",
      input.modelSemanticBytes,
      MAX_TURN_MODEL_SEMANTIC_BYTES,
    );
    const dependencyKeyExaminations = yield* captureField(
      "dependencyKeyExaminations",
      input.dependencyKeyExaminations,
      MAX_TURN_DEPENDENCY_KEY_EXAMINATIONS,
    );
    const canonicalDependencyBytes = yield* captureField(
      "canonicalDependencyBytes",
      input.canonicalDependencyBytes,
      MAX_TURN_CANONICAL_DEPENDENCY_BYTES,
    );
    const newWorkWindowMilliseconds = yield* captureField(
      "newWorkWindowMilliseconds",
      input.newWorkWindowMilliseconds,
      MAX_TURN_WINDOW_MILLISECONDS,
    );
    if (newWorkWindowMilliseconds <= settlementReserveMilliseconds) {
      return yield* budgetFailure(
        operation,
        "newWorkWindowMilliseconds",
        "notGreaterThanSettlementReserve",
        newWorkWindowMilliseconds,
      );
    }
    return Object.freeze({
      sourceReads,
      admittedBatches,
      sourceTransportBytes,
      modelSemanticWorkUnits,
      modelSemanticBytes,
      dependencyKeyExaminations,
      canonicalDependencyBytes,
      newWorkWindowMilliseconds,
    });
  });
}

export function captureCatchUpTurnBudget(
  operation: "catchUp",
  input: CatchUpTurnBudget,
  settlementReserveMilliseconds: number,
): Result.Result<CatchUpTurnBudget, InvalidQuerySyncTurnBudgetError> {
  return captureCatchUpFields(
    operation,
    input,
    settlementReserveMilliseconds,
  );
}

export function captureEvaluationTurnBudget(
  operation: "beginQuery" | "runEvaluationWork",
  input: EvaluationTurnBudget,
  settlementReserveMilliseconds: number,
): Result.Result<EvaluationTurnBudget, InvalidQuerySyncTurnBudgetError> {
  return Result.gen(function* () {
    const common = yield* captureCatchUpFields(
      operation,
      input,
      settlementReserveMilliseconds,
    );
    const evaluatedQueries = input.evaluatedQueries;
    if (!isPositiveSafeInteger(evaluatedQueries)) {
      return yield* budgetFailure(
        operation,
        "evaluatedQueries",
        "invalidValue",
        evaluatedQueries,
      );
    }
    if (evaluatedQueries > MAX_TURN_EVALUATED_QUERIES) {
      return yield* budgetFailure(
        operation,
        "evaluatedQueries",
        "aboveHardMaximum",
        evaluatedQueries,
      );
    }
    const evaluatorCallsPerQuery = input.evaluatorCallsPerQuery;
    if (!isPositiveSafeInteger(evaluatorCallsPerQuery)) {
      return yield* budgetFailure(
        operation,
        "evaluatorCallsPerQuery",
        "invalidValue",
        evaluatorCallsPerQuery,
      );
    }
    if (evaluatorCallsPerQuery > MAX_EVALUATOR_CALLS_PER_QUERY) {
      return yield* budgetFailure(
        operation,
        "evaluatorCallsPerQuery",
        "aboveHardMaximum",
        evaluatorCallsPerQuery,
      );
    }
    return Object.freeze({
      ...common,
      evaluatedQueries,
      evaluatorCallsPerQuery,
    });
  });
}

export function captureNamespaceCursorValue(
  cursor: NamespaceCursor,
): NamespaceCursor {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    appliedThroughSequence: cursor.appliedThroughSequence,
  });
}

export function makeTurnLedger(
  initialCursor: NamespaceCursor,
): OrchestrationTurnLedger {
  return {
    sourceCalls: 0,
    admittedBatches: 0,
    settledBatchTransitions: 0,
    sourceTransportBytes: 0,
    modelSemanticWorkUnits: 0,
    modelSemanticBytes: 0,
    dependencyKeyExaminations: 0,
    canonicalDependencyBytes: 0,
    claimedEvaluationAttempts: 0,
    evaluatorCalls: 0,
    completedEvaluations: 0,
    replayedEvaluations: 0,
    supersededEvaluations: 0,
    recoveryEvidenceExpiredEvaluations: 0,
    blockedEvaluations: 0,
    lastDurableCursor: captureNamespaceCursorValue(initialCursor),
  };
}

export function freezeTurnProgress(
  ledger: OrchestrationTurnLedger,
): OrchestrationTurnProgress {
  return Object.freeze({
    sourceCalls: ledger.sourceCalls,
    admittedBatches: ledger.admittedBatches,
    settledBatchTransitions: ledger.settledBatchTransitions,
    sourceTransportBytes: ledger.sourceTransportBytes,
    modelSemanticWorkUnits: ledger.modelSemanticWorkUnits,
    modelSemanticBytes: ledger.modelSemanticBytes,
    dependencyKeyExaminations: ledger.dependencyKeyExaminations,
    canonicalDependencyBytes: ledger.canonicalDependencyBytes,
    claimedEvaluationAttempts: ledger.claimedEvaluationAttempts,
    evaluatorCalls: ledger.evaluatorCalls,
    completedEvaluations: ledger.completedEvaluations,
    replayedEvaluations: ledger.replayedEvaluations,
    supersededEvaluations: ledger.supersededEvaluations,
    recoveryEvidenceExpiredEvaluations:
      ledger.recoveryEvidenceExpiredEvaluations,
    blockedEvaluations: ledger.blockedEvaluations,
    lastDurableCursor: captureNamespaceCursorValue(
      ledger.lastDurableCursor,
    ),
  });
}

export function freezeEvaluationContinuation(
  phase: EvaluationTurnContinuation["phase"],
  reason: EvaluationContinuationReason,
  scan: EvaluationWorkScanContinuation | null,
): EvaluationTurnContinuation {
  return Object.freeze({ phase, reason, scan });
}
