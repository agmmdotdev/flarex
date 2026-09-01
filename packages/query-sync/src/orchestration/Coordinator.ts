import { Effect, Result } from "effect";

import type { AdmittedChangeSource } from "../change/Model.js";
import {
  captureQueryGeneration,
} from "../kernel/CanonicalValue.js";
import type {
  BeginQueryEvaluationError,
} from "../kernel/Policy.js";
import {
  captureNamespaceCursor,
  captureQueryDescriptor,
} from "../kernel/Model.js";
import type {
  BeginQueryEvaluationRequest,
  NamespaceCursor,
  QueryDescriptor,
} from "../kernel/Model.js";
import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
} from "../kernel/EvaluationWork.js";
import type {
  EvaluationWorkScanContinuation,
} from "../kernel/EvaluationWork.js";
import type { QuerySyncTransitionState } from "../state/Port.js";
import type {
  BeginQueryEvaluationReceipt,
} from "../state/Receipts.js";
import {
  catchUpNamespace,
  makeTurnRuntime,
} from "./CatchUp.js";
import type {
  OrchestrationTurnRuntime,
} from "./CatchUp.js";
import type {
  BeginQueryTurnError,
  CatchUpTurnError,
  EvaluationWorkTurnError,
  NamespaceQuerySyncConstructionError,
} from "./Errors.js";
import {
  captureAdmittedChangeSource,
  makeCatchUpOperation,
} from "./CatchUpCoordinator.js";
import {
  evaluationBlockedOutcome,
  makeEvaluationCallLedger,
  runEvaluationAttempt,
  toEvaluationBoundary,
} from "./Evaluation.js";
import {
  captureCatchUpTurnBudget,
  captureEvaluationTurnBudget,
  captureNamespaceQuerySyncPolicy,
  freezeEvaluationContinuation,
  freezeTurnProgress,
  makeTurnLedger,
} from "./Model.js";
import type {
  BeginQueryTurnOutcome,
  CatchUpTurnBudget,
  CatchUpTurnOutcome,
  EvaluationTurnBudget,
  EvaluationWorkTurnOutcome,
  NamespaceQuerySyncPolicy,
} from "./Model.js";
import type {
  EvaluationCallBudget,
  QueryEvaluator,
  QuerySyncOrchestrationState,
} from "./Ports.js";
import {
  canStartBefore,
  runStateOperationWithRetry,
} from "./Turn.js";

export interface NamespaceQuerySyncInput {
  readonly bootstrapCursor: NamespaceCursor;
  readonly source: AdmittedChangeSource;
  readonly state: QuerySyncTransitionState;
  readonly evaluator: QueryEvaluator;
  readonly policy: NamespaceQuerySyncPolicy;
}

export interface EvaluationWorkTurnRequest {
  readonly continuation: EvaluationWorkScanContinuation | null;
}

export interface NamespaceQuerySync {
  readonly catchUp: (
    budget: CatchUpTurnBudget,
  ) => Effect.Effect<CatchUpTurnOutcome, CatchUpTurnError, never>;
  readonly beginQuery: (
    descriptor: QueryDescriptor,
    budget: EvaluationTurnBudget,
  ) => Effect.Effect<BeginQueryTurnOutcome, BeginQueryTurnError, never>;
  readonly runEvaluationWork: (
    request: EvaluationWorkTurnRequest,
    budget: EvaluationTurnBudget,
  ) => Effect.Effect<
    EvaluationWorkTurnOutcome,
    EvaluationWorkTurnError,
    never
  >;
}

function captureState(
  state: QuerySyncTransitionState,
): QuerySyncOrchestrationState {
  const initializeOrInspectNamespace = state.initializeOrInspectNamespace;
  const beginQueryEvaluation = state.beginQueryEvaluation;
  const applyAdmittedBatchAndAdvance = state.applyAdmittedBatchAndAdvance;
  const completeQueryEvaluation = state.completeQueryEvaluation;
  const claimEvaluationWork = state.claimEvaluationWork;
  const recordEvaluationAttemptOutcome =
    state.recordEvaluationAttemptOutcome;
  return Object.freeze({
    initializeOrInspectNamespace: (cursor) =>
      initializeOrInspectNamespace.call(state, cursor),
    beginQueryEvaluation: (request) =>
      beginQueryEvaluation.call(state, request),
    applyAdmittedBatchAndAdvance: (batch) =>
      applyAdmittedBatchAndAdvance.call(state, batch),
    completeQueryEvaluation: (attempt, evaluation, refresh, publication) =>
      completeQueryEvaluation.call(
        state,
        attempt,
        evaluation,
        refresh,
        publication,
      ),
    claimEvaluationWork: (request) =>
      claimEvaluationWork.call(state, request),
    recordEvaluationAttemptOutcome: (attempt, outcome) =>
      recordEvaluationAttemptOutcome.call(state, attempt, outcome),
  });
}

function captureEvaluator(evaluator: QueryEvaluator): QueryEvaluator {
  const evaluate = evaluator.evaluate;
  const capturedEvaluate: QueryEvaluator["evaluate"] = (
    attempt,
    budget: EvaluationCallBudget,
  ) => evaluate.call(evaluator, attempt, budget);
  return Object.freeze({
    evaluate: capturedEvaluate,
  });
}

function makeEvaluationRuntime(
  bootstrapCursor: NamespaceCursor,
  source: AdmittedChangeSource,
  state: QuerySyncOrchestrationState,
  policy: NamespaceQuerySyncPolicy,
  budget: EvaluationTurnBudget,
): Effect.Effect<
  OrchestrationTurnRuntime<
    EvaluationTurnBudget,
    QuerySyncOrchestrationState
  >,
  never,
  never
> {
  return makeTurnRuntime({
    bootstrapCursor,
    source,
    state,
    policy,
    budget,
    ledger: makeTurnLedger(bootstrapCursor),
  });
}

function beginRequest(
  cursor: NamespaceCursor,
  descriptor: QueryDescriptor,
): BeginQueryEvaluationRequest {
  return Object.freeze({
    target: Object.freeze({
      namespaceId: cursor.namespaceId,
      syncModelId: cursor.syncModelId,
      sourceEpoch: cursor.sourceEpoch,
      descriptor,
    }),
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  });
}

type BeginCallResult =
  | Readonly<{
    readonly _tag: "receipt";
    readonly receipt: BeginQueryEvaluationReceipt;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly outcome: BeginQueryTurnOutcome;
  }>;

export function makeNamespaceQuerySync(
  input: NamespaceQuerySyncInput,
): Result.Result<NamespaceQuerySync, NamespaceQuerySyncConstructionError> {
  return Result.gen(function* () {
    const bootstrapCursor = yield* captureNamespaceCursor(
      input.bootstrapCursor,
    );
    const policy = yield* captureNamespaceQuerySyncPolicy(input.policy);
    const source = captureAdmittedChangeSource(input.source);
    const state = captureState(input.state);
    const evaluator = captureEvaluator(input.evaluator);

    const catchUp = makeCatchUpOperation({
      bootstrapCursor,
      source,
      state,
      policy,
    });

    const beginQuery: NamespaceQuerySync["beginQuery"] = Effect.fn(
      "QuerySync.Namespace.beginQuery",
    )(function*(descriptorInput, budgetInput): Effect.fn.Return<
      BeginQueryTurnOutcome,
      BeginQueryTurnError,
      never
    > {
      const budget = yield* Effect.fromResult(captureEvaluationTurnBudget(
        "beginQuery",
        budgetInput,
        policy.settlementReserveMilliseconds,
      ));
      const descriptor = yield* Effect.fromResult(captureQueryDescriptor(
        descriptorInput,
      ));
      const runtime = yield* makeEvaluationRuntime(
        bootstrapCursor,
        source,
        state,
        policy,
        budget,
      );
      const evaluatorCallLedger = makeEvaluationCallLedger();
      const caughtUp = yield* catchUpNamespace(
        runtime,
        "initialCatchUp",
      );
      if (caughtUp._tag !== "caughtUp") {
        return toEvaluationBoundary(caughtUp);
      }
      if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
        return Object.freeze({
          _tag: "continuationRequired",
          continuation: freezeEvaluationContinuation(
            "evaluation",
            "deadlineReached",
            null,
          ),
          progress: freezeTurnProgress(runtime.ledger),
        });
      }

      const request = beginRequest(bootstrapCursor, descriptor);
      const call = yield* runStateOperationWithRetry<
        BeginQueryEvaluationReceipt,
        "beginQueryEvaluation",
        BeginQueryEvaluationError
      >({
        operation: "beginQueryEvaluation",
        invoke: () => state.beginQueryEvaluation(request),
        policy,
        cutoffNanos: runtime.admissionCutoffNanos,
        replayUnknown: true,
      }).pipe(
        Effect.map((receipt): BeginCallResult => Object.freeze({
          _tag: "receipt",
          receipt,
        })),
        Effect.catchTag("QueryEvaluationWorkBlockedError", (error) => {
          if (error.queryKey !== descriptor.queryKey) {
            return Effect.die(
              "Blocked begin evidence crossed the requested descriptor",
            );
          }
          return Result.match(captureQueryGeneration(error.generation), {
            onFailure: () => Effect.die(
              "Blocked begin evidence carried an invalid generation",
            ),
            onSuccess: (generation) => Effect.succeed(Object.freeze({
              _tag: "blocked",
              outcome: evaluationBlockedOutcome(runtime, {
                queryKey: descriptor.queryKey,
                generation,
                reason: error.reason,
                resetRequired: error.resetRequired,
              }),
            })),
          });
        }),
      );
      if (call._tag === "blocked") return call.outcome;
      const receipt = call.receipt;
      switch (receipt._tag) {
        case "created":
        case "replayed":
          return yield* runEvaluationAttempt(
            runtime,
            evaluator,
            receipt.attempt,
            evaluatorCallLedger,
          );
        case "alreadyAdvanced":
          return Object.freeze({
            _tag: "alreadyActive",
            descriptor: receipt.descriptor,
            requestedExpectedActiveGeneration: null,
            activeGeneration: receipt.activeGeneration,
            freshThroughSequence: receipt.freshThroughSequence,
            progress: freezeTurnProgress(runtime.ledger),
          });
        case "notDirty":
          return yield* Effect.die(
            "First query registration unexpectedly returned notDirty",
          );
      }
    });

    const runEvaluationWork: NamespaceQuerySync["runEvaluationWork"] =
      Effect.fn("QuerySync.Namespace.runEvaluationWork")(
        function*(request, budgetInput): Effect.fn.Return<
          EvaluationWorkTurnOutcome,
          EvaluationWorkTurnError,
          never
        > {
          const budget = yield* Effect.fromResult(captureEvaluationTurnBudget(
            "runEvaluationWork",
            budgetInput,
            policy.settlementReserveMilliseconds,
          ));
          let continuation = request.continuation;
          const runtime = yield* makeEvaluationRuntime(
            bootstrapCursor,
            source,
            state,
            policy,
            budget,
          );
          const evaluatorCallLedger = makeEvaluationCallLedger();
          const caughtUp = yield* catchUpNamespace(
            runtime,
            "initialCatchUp",
          );
          if (caughtUp._tag !== "caughtUp") {
            return toEvaluationBoundary(caughtUp);
          }
          let evaluatedQueries = 0;

          while (true) {
            if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
              return Object.freeze({
                _tag: "continuationRequired",
                continuation: freezeEvaluationContinuation(
                  "evaluation",
                  "deadlineReached",
                  null,
                ),
                progress: freezeTurnProgress(runtime.ledger),
              });
            }

            const claimRequest = Object.freeze({
              maximumQueryInspections:
                MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
              continuation,
            });
            const claim = yield* runStateOperationWithRetry({
              operation: "claimEvaluationWork",
              invoke: () => state.claimEvaluationWork(claimRequest),
              policy,
              cutoffNanos: runtime.admissionCutoffNanos,
              replayUnknown: false,
            });
            switch (claim._tag) {
              case "continued":
              case "scanRestarted":
                return Object.freeze({
                  _tag: "continuationRequired",
                  continuation: freezeEvaluationContinuation(
                    "evaluation",
                    claim._tag === "continued"
                      ? "scanContinued"
                      : "scanRestarted",
                    claim.continuation,
                  ),
                  progress: freezeTurnProgress(runtime.ledger),
                });
              case "blocked":
                return evaluationBlockedOutcome(
                  runtime,
                  claim.blockedWork,
                );
              case "none":
                return Object.freeze({
                  _tag: "idle",
                  progress: freezeTurnProgress(runtime.ledger),
                });
              case "claimed": {
                runtime.ledger.claimedEvaluationAttempts += 1;
                if (evaluatedQueries >= budget.evaluatedQueries) {
                  return Object.freeze({
                    _tag: "continuationRequired",
                    continuation: freezeEvaluationContinuation(
                      "evaluation",
                      "evaluatedQueryLimitReached",
                      null,
                    ),
                    progress: freezeTurnProgress(runtime.ledger),
                  });
                }
                evaluatedQueries += 1;
                const outcome = yield* runEvaluationAttempt(
                  runtime,
                  evaluator,
                  claim.attempt,
                  evaluatorCallLedger,
                );
                switch (outcome._tag) {
                  case "completed":
                  case "replayed":
                  case "superseded":
                  case "recoveryEvidenceExpired":
                    continuation = null;
                    break;
                  default:
                    return outcome;
                }
                break;
              }
              default: {
                const unexpectedReceipt: never = claim;
                return yield* Effect.die(unexpectedReceipt);
              }
            }
          }
        },
      );

    return Object.freeze({ catchUp, beginQuery, runEvaluationWork });
  });
}
