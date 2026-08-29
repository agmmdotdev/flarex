import { Clock, Effect, Result } from "effect";

import { admitGenerationRefreshEvidence } from "../change/Admission.js";
import type {
  ChangeSourceReadRequest,
  CaughtUpChangeAuthority,
} from "../change/Model.js";
import {
  querySnapshotAsSyncSequence,
  successorSyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalQueryKey,
  QueryGeneration,
} from "../kernel/CanonicalValue.js";
import type {
  AdmittedInvalidationBatch,
  GenerationRefreshEvidence,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryEvaluationEvidenceInput,
} from "../kernel/Model.js";
import {
  captureQueryEvaluationEvidence,
} from "../kernel/Model.js";
import {
  captureQueryPublicationArtifact,
} from "../kernel/Publication.js";
import type {
  QueryPublicationArtifact,
  QueryPublicationArtifactInput,
} from "../kernel/Publication.js";
import type {
  EvaluationAttemptOutcome,
} from "../kernel/EvaluationWork.js";
import type {
  CompleteQueryEvaluationError,
} from "../kernel/Policy.js";
import type {
  CompleteQueryEvaluationReceipt,
  RecordEvaluationAttemptOutcomeReceipt,
} from "../state/Receipts.js";
import {
  applyAdmittedBatch,
  catchUpNamespace,
  chargeAdmittedPage,
  inspectNamespace,
  nextSourceStopReason,
  readAdmittedPage,
} from "./CatchUp.js";
import type {
  OrchestrationTurnRuntime,
} from "./CatchUp.js";
import {
  EvaluationOutcomeSettlementDeadlineError,
  InvalidQueryEvaluationArtifactError,
} from "./Errors.js";
import type {
  EvaluationPipelineError,
  QueryEvaluationArtifactCaptureError,
  QueryEvaluatorError,
} from "./Errors.js";
import {
  freezeEvaluationContinuation,
  freezeTurnProgress,
} from "./Model.js";
import type {
  BeginQueryTurnOutcome,
  CatchUpBoundaryOutcome,
  EvaluationBoundaryOutcome,
  EvaluationContinuationReason,
  EvaluationTurnBudget,
} from "./Model.js";
import type {
  EvaluationCallBudget,
  QueryEvaluationArtifact,
  QueryEvaluator,
} from "./Ports.js";
import {
  awaitRetryDelay,
  canStartBefore,
  remainingAdmissionMilliseconds,
  runStateOperationWithRetry,
} from "./Turn.js";

type EvaluationRuntime = OrchestrationTurnRuntime<EvaluationTurnBudget>;

export type EvaluationCallLedger = Map<
  CanonicalQueryKey,
  Map<QueryGeneration, number>
>;

export function makeEvaluationCallLedger(): EvaluationCallLedger {
  return new Map();
}

function callsUsedForAttempt(
  ledger: EvaluationCallLedger,
  attempt: QueryEvaluationAttempt,
): number {
  return ledger.get(attempt.descriptor.queryKey)?.get(attempt.generation) ?? 0;
}

function recordEvaluatorCall(
  ledger: EvaluationCallLedger,
  attempt: QueryEvaluationAttempt,
  callsUsed: number,
): void {
  let callsByGeneration = ledger.get(attempt.descriptor.queryKey);
  if (callsByGeneration === undefined) {
    callsByGeneration = new Map();
    ledger.set(attempt.descriptor.queryKey, callsByGeneration);
  }
  callsByGeneration.set(attempt.generation, callsUsed);
}

export type EvaluationAttemptTurnOutcome = Exclude<
  BeginQueryTurnOutcome,
  { readonly _tag: "alreadyActive" }
>;

type EvaluatorCallResult =
  | Readonly<{
    readonly _tag: "artifact";
    readonly artifact: QueryEvaluationArtifact;
  }>
  | Readonly<{
    readonly _tag: "transientFailure";
    readonly error: Exclude<
      QueryEvaluatorError,
      { readonly _tag: "QueryEvaluatorRefusedError" }
    >;
  }>
  | Readonly<{
    readonly _tag: "terminalFailure";
    readonly error: Extract<
      QueryEvaluatorError,
      { readonly _tag: "QueryEvaluatorRefusedError" }
    >;
  }>;

type RefreshCollectionResult =
  | Readonly<{
    readonly _tag: "ready";
    readonly batches: readonly AdmittedInvalidationBatch[];
    readonly authority: CaughtUpChangeAuthority;
  }>
  | Readonly<{
    readonly _tag: "refreshHistoryUnavailable";
  }>
  | EvaluationBoundaryOutcome;

function artifactMismatch(
  attempt: QueryEvaluationAttempt,
  reason: InvalidQueryEvaluationArtifactError["reason"],
): InvalidQueryEvaluationArtifactError {
  return new InvalidQueryEvaluationArtifactError({
    operation: "captureQueryEvaluationArtifact",
    reason,
    queryKey: attempt.descriptor.queryKey,
    generation: attempt.generation,
  });
}

export function captureQueryEvaluationArtifact(
  attempt: QueryEvaluationAttempt,
  input: Readonly<{
    readonly evaluation: QueryEvaluationEvidenceInput;
    readonly publication: QueryPublicationArtifactInput;
  }>,
): Result.Result<
  QueryEvaluationArtifact,
  QueryEvaluationArtifactCaptureError
> {
  return Result.gen(function* () {
    const evaluation = yield* captureQueryEvaluationEvidence(
      input.evaluation,
    );
    if (evaluation.namespaceId !== attempt.namespaceId) {
      return yield* Result.fail(artifactMismatch(
        attempt,
        "namespaceMismatch",
      ));
    }
    if (evaluation.syncModelId !== attempt.syncModelId) {
      return yield* Result.fail(artifactMismatch(attempt, "modelMismatch"));
    }
    if (evaluation.sourceEpoch !== attempt.sourceEpoch) {
      return yield* Result.fail(artifactMismatch(attempt, "epochMismatch"));
    }
    if (evaluation.descriptor.queryKey !== attempt.descriptor.queryKey) {
      return yield* Result.fail(artifactMismatch(
        attempt,
        "queryKeyMismatch",
      ));
    }
    if (
      evaluation.descriptor.queryIdentity
        !== attempt.descriptor.queryIdentity
    ) {
      return yield* Result.fail(artifactMismatch(
        attempt,
        "queryIdentityMismatch",
      ));
    }
    if (evaluation.generation !== attempt.generation) {
      return yield* Result.fail(artifactMismatch(
        attempt,
        "generationMismatch",
      ));
    }
    if (
      evaluation.snapshotSequence
        < attempt.registrationCursor.appliedThroughSequence
    ) {
      return yield* Result.fail(artifactMismatch(
        attempt,
        "snapshotBeforeRegistration",
      ));
    }
    if (
      attempt.requestedDirtyThroughSequence !== null
      && evaluation.snapshotSequence
        < attempt.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(artifactMismatch(
        attempt,
        "snapshotBeforeRequestedDirtyFrontier",
      ));
    }
    const publication = yield* captureQueryPublicationArtifact(
      input.publication,
    );
    return Object.freeze({ evaluation, publication });
  });
}

export function toEvaluationBoundary(
  boundary: CatchUpBoundaryOutcome,
): EvaluationBoundaryOutcome {
  if (boundary._tag !== "continuationRequired") return boundary;
  return Object.freeze({
    _tag: "continuationRequired",
    continuation: freezeEvaluationContinuation(
      boundary.phase,
      boundary.reason,
      null,
    ),
    progress: boundary.progress,
  });
}

function continuation(
  runtime: EvaluationRuntime,
  reason: EvaluationContinuationReason,
  phase: "evaluation" | "postEvaluationCatchUp" | "refreshReplay" =
    "evaluation",
): EvaluationBoundaryOutcome {
  return Object.freeze({
    _tag: "continuationRequired",
    continuation: freezeEvaluationContinuation(phase, reason, null),
    progress: freezeTurnProgress(runtime.ledger),
  });
}

export function evaluationBlockedOutcome(
  runtime: EvaluationRuntime,
  blockedWork: Readonly<{
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
    readonly reason: "terminalEvaluatorRefusal";
    readonly resetRequired: true;
  }>,
): EvaluationBoundaryOutcome {
  runtime.ledger.blockedEvaluations += 1;
  return Object.freeze({
    _tag: "evaluationBlocked",
    blockedWork: Object.freeze({
      queryKey: blockedWork.queryKey,
      generation: blockedWork.generation,
      reason: "terminalEvaluatorRefusal",
      resetRequired: true,
    }),
    continuation: null,
    progress: freezeTurnProgress(runtime.ledger),
  });
}

function staleOutcome(
  runtime: EvaluationRuntime,
  receipt: Extract<
    RecordEvaluationAttemptOutcomeReceipt | CompleteQueryEvaluationReceipt,
    { readonly _tag: "superseded" | "recoveryEvidenceExpired" }
  >,
): EvaluationAttemptTurnOutcome {
  if (receipt._tag === "superseded") {
    runtime.ledger.supersededEvaluations += 1;
  } else {
    runtime.ledger.recoveryEvidenceExpiredEvaluations += 1;
  }
  return Object.freeze({
    _tag: receipt._tag,
    generation: receipt.generation,
    activeGeneration: receipt.activeGeneration,
    progress: freezeTurnProgress(runtime.ledger),
  });
}

function captureSourceRequest(
  evaluation: QueryEvaluationEvidence,
  afterSequence: ReturnType<typeof querySnapshotAsSyncSequence>,
): ChangeSourceReadRequest {
  return Object.freeze({
    namespaceId: evaluation.namespaceId,
    syncModelId: evaluation.syncModelId,
    sourceEpoch: evaluation.sourceEpoch,
    requestedAfterSequenceExclusive: afterSequence,
  });
}

const collectRefresh = Effect.fn(
  "QuerySync.Orchestration.collectRefresh",
)(function*(
  runtime: EvaluationRuntime,
  evaluation: QueryEvaluationEvidence,
  initialBatches: readonly AdmittedInvalidationBatch[],
  initialAfterSequence: ReturnType<typeof querySnapshotAsSyncSequence>,
): Effect.fn.Return<
  RefreshCollectionResult,
  EvaluationPipelineError,
  never
> {
  const batches = [...initialBatches];
  let afterSequence = initialAfterSequence;

  while (true) {
    const stopReason = yield* nextSourceStopReason(runtime);
    if (stopReason !== null) {
      return continuation(runtime, stopReason, "refreshReplay");
    }
    const read = yield* readAdmittedPage(
      runtime,
      captureSourceRequest(evaluation, afterSequence),
    );
    if (read._tag === "historyUnavailable") {
      return Object.freeze({ _tag: "refreshHistoryUnavailable" });
    }
    if (read._tag === "epochReplaced") {
      return toEvaluationBoundary(Object.freeze({
        _tag: "epochReplaced",
        phase: "refreshReplay",
        evidence: Object.freeze({ source: "changeSource", value: read }),
        progress: freezeTurnProgress(runtime.ledger),
      }));
    }
    if (read._tag === "budgetInsufficient") {
      return toEvaluationBoundary(Object.freeze({
        _tag: "budgetInsufficient",
        phase: "refreshReplay",
        evidence: read,
        progress: freezeTurnProgress(runtime.ledger),
      }));
    }

    chargeAdmittedPage(runtime.ledger, read);
    for (const batch of read.batches) {
      batches.push(batch);
      if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
        return continuation(runtime, "deadlineReached", "refreshReplay");
      }
      const applied = yield* applyAdmittedBatch(runtime, batch);
      if (applied._tag === "gap") {
        return toEvaluationBoundary(Object.freeze({
          _tag: "gap",
          phase: "refreshReplay",
          expectedSequence: applied.expectedSequence,
          observedSequence: applied.observedSequence,
          progress: freezeTurnProgress(runtime.ledger),
        }));
      }
      if (applied._tag === "resetRequired") {
        return toEvaluationBoundary(Object.freeze({
          _tag: "resetRequired",
          phase: "refreshReplay",
          expectedSourceEpoch: applied.expectedSourceEpoch,
          observedSourceEpoch: applied.observedSourceEpoch,
          progress: freezeTurnProgress(runtime.ledger),
        }));
      }
    }

    if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
      return continuation(runtime, "deadlineReached", "refreshReplay");
    }
    const inspected = yield* inspectNamespace(runtime, "refreshReplay");
    if (!("appliedThroughSequence" in inspected)) {
      return toEvaluationBoundary(inspected);
    }
    if (read.hasMore) {
      afterSequence = read.readThroughSequence;
      continue;
    }

    const authority = read.caughtUpAuthority;
    if (
      authority.readThroughSequence
        === inspected.appliedThroughSequence
    ) {
      return Object.freeze({
        _tag: "ready",
        batches: Object.freeze(batches),
        authority,
      });
    }
    if (
      authority.readThroughSequence < inspected.appliedThroughSequence
    ) {
      afterSequence = authority.readThroughSequence;
      continue;
    }
    const expectedSequence = successorSyncSequence(
      inspected.appliedThroughSequence,
    );
    if (expectedSequence === null) {
      return yield* Effect.die(
        "Refresh cursor cannot advance beyond its maximum",
      );
    }
    return toEvaluationBoundary(Object.freeze({
      _tag: "gap",
      phase: "refreshReplay",
      expectedSequence,
      observedSequence: authority.readThroughSequence,
      progress: freezeTurnProgress(runtime.ledger),
    }));
  }
});

const evaluateOnce = Effect.fn(
  "QuerySync.Orchestration.evaluateOnce",
)(function*(
  runtime: EvaluationRuntime,
  evaluator: QueryEvaluator,
  attempt: QueryEvaluationAttempt,
  callsUsed: number,
): Effect.fn.Return<
  EvaluatorCallResult | EvaluationBoundaryOutcome,
  QueryEvaluationArtifactCaptureError,
  never
> {
  if (callsUsed >= runtime.budget.evaluatorCallsPerQuery) {
    return continuation(runtime, "evaluatorCallLimitReached");
  }
  const nowNanos = yield* Clock.currentTimeNanos;
  const maximumSettlementMilliseconds = remainingAdmissionMilliseconds(
    runtime.admissionCutoffNanos,
    nowNanos,
  );
  if (maximumSettlementMilliseconds < 1) {
    return continuation(runtime, "deadlineReached");
  }
  const callBudget: EvaluationCallBudget = Object.freeze({
    remainingEvaluatorCallsIncludingThisCall:
      runtime.budget.evaluatorCallsPerQuery - callsUsed,
    maximumSettlementMilliseconds,
  });
  runtime.ledger.evaluatorCalls += 1;
  const result = yield* evaluator.evaluate(attempt, callBudget).pipe(
    Effect.map((artifact): EvaluatorCallResult => Object.freeze({
      _tag: "artifact",
      artifact,
    })),
    Effect.catchTags({
      QueryEvaluatorUnavailableError: (error) => Effect.succeed(
        Object.freeze({
          _tag: "transientFailure",
          error,
        }) satisfies EvaluatorCallResult,
      ),
      QueryEvaluatorTimeoutError: (error) => Effect.succeed(Object.freeze({
        _tag: "transientFailure",
        error,
      }) satisfies EvaluatorCallResult),
      QueryEvaluatorRefusedError: (error) => Effect.succeed(Object.freeze({
        _tag: "terminalFailure",
        error,
      }) satisfies EvaluatorCallResult),
    }),
  );
  if (result._tag !== "artifact") return result;
  const captured = yield* Effect.fromResult(captureQueryEvaluationArtifact(
    attempt,
    result.artifact,
  ));
  return Object.freeze({ _tag: "artifact", artifact: captured });
});

const recordEvaluatorOutcome = Effect.fn(
  "QuerySync.Orchestration.recordEvaluatorOutcome",
)(function*(
  runtime: EvaluationRuntime,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
): Effect.fn.Return<
  EvaluationAttemptTurnOutcome,
  EvaluationPipelineError,
  never
> {
  const nowNanos = yield* Clock.currentTimeNanos;
  if (nowNanos >= runtime.settlementCutoffNanos) {
    return yield* new EvaluationOutcomeSettlementDeadlineError({
      operation: "recordEvaluationAttemptOutcome",
      reason: "settlementWindowElapsed",
      queryKey: attempt.descriptor.queryKey,
      generation: attempt.generation,
      outcome,
    });
  }
  const receipt = yield* runStateOperationWithRetry({
    operation: "recordEvaluationAttemptOutcome",
    invoke: () => runtime.state.recordEvaluationAttemptOutcome(
      attempt,
      outcome,
    ),
    policy: runtime.policy,
    cutoffNanos: runtime.settlementCutoffNanos,
    replayUnknown: true,
  });
  switch (receipt._tag) {
    case "blocked":
      return evaluationBlockedOutcome(runtime, receipt.blockedWork);
    case "superseded":
    case "recoveryEvidenceExpired":
      return staleOutcome(runtime, receipt);
    case "eligible":
      if (outcome === "terminalRefusal") {
        return yield* Effect.die(
          "Terminal evaluator refusal remained eligible after settlement",
        );
      }
      return continuation(runtime, "transientEvaluatorExhausted");
  }
});

type CompletionCallResult =
  | Readonly<{
    readonly _tag: "receipt";
    readonly receipt: CompleteQueryEvaluationReceipt;
  }>
  | Readonly<{
    readonly _tag: "blockedError";
    readonly blockedWork: Readonly<{
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
      readonly reason: "terminalEvaluatorRefusal";
      readonly resetRequired: true;
    }>;
  }>;

const completeEvaluation = Effect.fn(
  "QuerySync.Orchestration.completeEvaluation",
)(function*(
  runtime: EvaluationRuntime,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  publication: QueryPublicationArtifact,
  refresh: GenerationRefreshEvidence,
): Effect.fn.Return<
  CompletionCallResult,
  EvaluationPipelineError,
  never
> {
  const result = yield* runStateOperationWithRetry<
    CompleteQueryEvaluationReceipt,
    "completeQueryEvaluation",
    CompleteQueryEvaluationError
  >({
    operation: "completeQueryEvaluation",
    invoke: () => runtime.state.completeQueryEvaluation(
      attempt,
      evaluation,
      refresh,
      publication,
    ),
    policy: runtime.policy,
    cutoffNanos: runtime.admissionCutoffNanos,
    replayUnknown: true,
  }).pipe(
    Effect.map((receipt): CompletionCallResult => Object.freeze({
      _tag: "receipt",
      receipt,
    })),
    Effect.catchTag("QueryEvaluationWorkBlockedError", (error) =>
      error.queryKey !== attempt.descriptor.queryKey
        || error.generation !== attempt.generation
        ? Effect.die(
          "Blocked completion evidence crossed the evaluation attempt",
        )
        : Effect.succeed(Object.freeze({
          _tag: "blockedError",
          blockedWork: Object.freeze({
            queryKey: attempt.descriptor.queryKey,
            generation: attempt.generation,
            reason: error.reason,
            resetRequired: error.resetRequired,
          }),
        }))),
  );
  return result;
});

export interface RunEvaluationAttempt {
  (
    runtime: EvaluationRuntime,
    evaluator: QueryEvaluator,
    attempt: QueryEvaluationAttempt,
    callLedger: EvaluationCallLedger,
  ): Effect.Effect<
    EvaluationAttemptTurnOutcome,
    EvaluationPipelineError,
    never
  >;
}

export const runEvaluationAttempt: RunEvaluationAttempt = Effect.fn(
  "QuerySync.Orchestration.runEvaluationAttempt",
)(function*(
  runtime: EvaluationRuntime,
  evaluator: QueryEvaluator,
  attempt: QueryEvaluationAttempt,
  callLedger: EvaluationCallLedger,
): Effect.fn.Return<
  EvaluationAttemptTurnOutcome,
  EvaluationPipelineError,
  never
> {
  let callsUsed = callsUsedForAttempt(callLedger, attempt);
  let reevaluationReason: "resnapshotRequired" | "rerunRequired" | null =
    null;
  let transientRetryPending = false;

  while (true) {
    const evaluated = yield* evaluateOnce(
      runtime,
      evaluator,
      attempt,
      callsUsed,
    );
    if (
      evaluated._tag === "continuationRequired"
      || evaluated._tag === "budgetInsufficient"
      || evaluated._tag === "historyUnavailable"
      || evaluated._tag === "modelReplaced"
      || evaluated._tag === "epochReplaced"
      || evaluated._tag === "gap"
      || evaluated._tag === "resetRequired"
      || evaluated._tag === "evaluationBlocked"
    ) {
      if (
        transientRetryPending
        && evaluated._tag === "continuationRequired"
        && (
          evaluated.continuation.reason === "deadlineReached"
          || evaluated.continuation.reason === "evaluatorCallLimitReached"
        )
      ) {
        return yield* recordEvaluatorOutcome(
          runtime,
          attempt,
          "transientExhausted",
        );
      }
      if (
        reevaluationReason !== null
        && evaluated._tag === "continuationRequired"
        && evaluated.continuation.reason === "evaluatorCallLimitReached"
      ) {
        return continuation(runtime, reevaluationReason);
      }
      return evaluated;
    }
    callsUsed += 1;
    recordEvaluatorCall(callLedger, attempt, callsUsed);
    transientRetryPending = false;

    if (evaluated._tag === "terminalFailure") {
      return yield* recordEvaluatorOutcome(
        runtime,
        attempt,
        "terminalRefusal",
      );
    }
    if (evaluated._tag === "transientFailure") {
      if (callsUsed < runtime.budget.evaluatorCallsPerQuery) {
        const delay = runtime.policy.retryDelayMilliseconds[callsUsed - 1]
          ?? 0;
        const retryAllowed = yield* awaitRetryDelay(
          delay,
          runtime.admissionCutoffNanos,
        );
        if (retryAllowed) {
          transientRetryPending = true;
          continue;
        }
      }
      return yield* recordEvaluatorOutcome(
        runtime,
        attempt,
        "transientExhausted",
      );
    }

    const artifact = evaluated.artifact;
    const caughtUp = yield* catchUpNamespace(
      runtime,
      "postEvaluationCatchUp",
    );
    if (caughtUp._tag !== "caughtUp") {
      return toEvaluationBoundary(caughtUp);
    }

    let refreshResult = yield* collectRefresh(
      runtime,
      artifact.evaluation,
      Object.freeze([]),
      querySnapshotAsSyncSequence(artifact.evaluation.snapshotSequence),
    );
    if (refreshResult._tag === "refreshHistoryUnavailable") {
      if (callsUsed < runtime.budget.evaluatorCallsPerQuery) {
        reevaluationReason = "resnapshotRequired";
        continue;
      }
      return continuation(runtime, "resnapshotRequired");
    }
    if (refreshResult._tag !== "ready") return refreshResult;

    while (true) {
      if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
        return continuation(runtime, "deadlineReached");
      }
      const refresh = yield* Effect.fromResult(admitGenerationRefreshEvidence(
        artifact.evaluation,
        refreshResult.batches,
        refreshResult.authority,
      ));
      if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
        return continuation(runtime, "deadlineReached");
      }
      const completion = yield* completeEvaluation(
        runtime,
        attempt,
        artifact.evaluation,
        artifact.publication,
        refresh,
      );
      if (completion._tag === "blockedError") {
        return evaluationBlockedOutcome(runtime, completion.blockedWork);
      }
      const receipt = completion.receipt;
      switch (receipt._tag) {
        case "completed":
        case "replayed": {
          if (receipt._tag === "completed") {
            runtime.ledger.completedEvaluations += 1;
          } else {
            runtime.ledger.replayedEvaluations += 1;
          }
          return Object.freeze({
            _tag: receipt._tag,
            generation: receipt.generation,
            publicationDisposition: receipt.publicationDisposition,
            progress: freezeTurnProgress(runtime.ledger),
          });
        }
        case "superseded":
        case "recoveryEvidenceExpired":
          return staleOutcome(runtime, receipt);
        case "resnapshotRequired":
        case "rerunRequired":
          if (callsUsed >= runtime.budget.evaluatorCallsPerQuery) {
            return continuation(runtime, receipt._tag);
          }
          reevaluationReason = receipt._tag;
          break;
        case "refreshRequired": {
          refreshResult = yield* collectRefresh(
            runtime,
            artifact.evaluation,
            refreshResult.batches,
            refreshResult.authority.readThroughSequence,
          );
          if (refreshResult._tag === "refreshHistoryUnavailable") {
            if (callsUsed < runtime.budget.evaluatorCallsPerQuery) {
              reevaluationReason = "resnapshotRequired";
              break;
            }
            return continuation(runtime, "resnapshotRequired");
          }
          if (refreshResult._tag !== "ready") return refreshResult;
          continue;
        }
        default: {
          const unexpectedReceipt: never = receipt;
          return yield* Effect.die(unexpectedReceipt);
        }
      }
      break;
    }
  }
});
