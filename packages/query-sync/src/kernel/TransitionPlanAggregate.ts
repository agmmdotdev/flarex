import { Result } from "effect";

import { compareCanonicalBase64Url } from "./CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  CanonicalQueryKey,
} from "./CanonicalValue.js";
import {
  QuerySyncInvariantDefect,
} from "./Errors.js";
import type {
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncStateLimitError,
  QuerySyncWorkLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "./Errors.js";
import {
  findDependencyDirectoryEntry,
  findQueryState,
  rebuildQuerySyncState,
} from "./Model.js";
import type {
  ActiveQueryState,
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  QueryState,
  QuerySyncState,
} from "./Model.js";
import {
  planBeginQueryEvaluation,
} from "../transition-plan/BeginQueryEvaluation.js";
import type {
  BeginQueryEvaluationPlan,
  PlanBeginQueryEvaluationError,
} from "../transition-plan/BeginQueryEvaluation.js";
import {
  resumeApplyAdmittedBatchActiveFacts,
  resumeApplyAdmittedBatchAffectedTargets,
  startApplyAdmittedBatchAndAdvance,
} from "../transition-plan/ApplyAdmittedBatch.js";
import type {
  AffectedActiveTargetsRead,
  ApplyAdmittedBatchPlan,
  ResumeApplyAffectedActiveFactsError,
  ResumeApplyAffectedTargetsError,
  StartApplyAdmittedBatchError,
} from "../transition-plan/ApplyAdmittedBatch.js";
import {
  QuerySyncTransitionFactError,
} from "../transition-plan/Errors.js";
import {
  freezeBeginQueryFacts,
  projectActiveScalarFacts,
} from "../transition-plan/Facts.js";
import type {
  AffectedActiveQueryFacts,
  AffectedActiveQueryTarget,
  BeginQueryFacts,
} from "../transition-plan/Facts.js";
import {
  MAX_INVALIDATION_AFFECTED_QUERIES,
} from "../transition-plan/Limits.js";
import {
  freezeScopeFacts,
  querySyncStateMetricsEqual,
} from "../transition-plan/Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionDisposition,
} from "../transition-plan/Model.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
} from "../transition-plan/Receipts.js";

export interface AggregateTransition<Decision, Plan> {
  readonly decision: Decision;
  readonly disposition: TransitionDisposition;
  readonly plan: Plan;
}

export type BeginQueryEvaluationAggregateError = Exclude<
  PlanBeginQueryEvaluationError,
  QuerySyncTransitionFactError
> | BuildQuerySyncStateError;

export type ApplyAdmittedInvalidationsAggregateError =
  | QuerySyncNamespaceMismatchError<"applyAdmittedInvalidations">
  | QuerySyncModelMismatchError<"applyAdmittedInvalidations">
  | QuerySyncWorkLimitError<"applyAdmittedInvalidations">
  | QuerySyncWorkRevisionExhaustedError<"applyAdmittedInvalidations">
  | QuerySyncStateLimitError
  | BuildQuerySyncStateError;

function transitionInvariant(
  operation: "beginQueryEvaluation" | "applyAdmittedInvalidations",
  invariant: QuerySyncInvariantDefect["invariant"],
): QuerySyncInvariantDefect {
  return new QuerySyncInvariantDefect({ operation, invariant });
}

function throwTransitionFactDefect(
  error: QuerySyncTransitionFactError,
): never {
  const invariant = error.reason === "provisionalFenceMismatch"
    ? "provisionalFenceMismatch"
    : error.operation === "applyAdmittedInvalidations"
    ? "dependencyDirectoryEntryMissingActiveQuery"
    : "transitionPlanUnexpectedStep";
  throw transitionInvariant(error.operation, invariant);
}

function mapBeginPlannerError(
  error: PlanBeginQueryEvaluationError,
): BeginQueryEvaluationAggregateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? throwTransitionFactDefect(error)
    : error;
}

type ApplyPlannerError =
  | StartApplyAdmittedBatchError
  | ResumeApplyAffectedTargetsError
  | ResumeApplyAffectedActiveFactsError;

function mapApplyPlannerError(
  error: ApplyPlannerError,
): ApplyAdmittedInvalidationsAggregateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? throwTransitionFactDefect(error)
    : error;
}

export function projectQuerySyncScopeFacts(
  state: QuerySyncState,
): QuerySyncScopeFacts {
  return freezeScopeFacts({
    cursor: state.cursor,
    evaluationWork: state.evaluationWork,
    metrics: state.metrics,
  });
}

function projectBeginFacts(
  query: QueryState | undefined,
): BeginQueryFacts | null {
  return query === undefined
    ? null
    : freezeBeginQueryFacts({
      descriptor: query.descriptor,
      active: query.active === null
        ? null
        : projectActiveScalarFacts(query.active),
      provisional: query.provisional,
    });
}

function replaceQuery(
  queries: readonly QueryState[],
  replacement: QueryState,
): readonly QueryState[] {
  let replaced = false;
  const next = queries.map((query) => {
    if (query.descriptor.queryKey !== replacement.descriptor.queryKey) {
      return query;
    }
    replaced = true;
    return replacement;
  });
  return replaced ? next : [...next, replacement];
}

function beginDecision(
  receipt: BeginQueryEvaluationReceipt,
  state: QuerySyncState,
): BeginQueryEvaluationDecision {
  switch (receipt._tag) {
    case "created":
    case "replayed":
      return Object.freeze({
        _tag: receipt._tag,
        state,
        attempt: receipt.attempt,
      });
    case "alreadyAdvanced":
      return Object.freeze({
        _tag: "alreadyAdvanced",
        state,
        descriptor: receipt.descriptor,
        requestedExpectedActiveGeneration:
          receipt.requestedExpectedActiveGeneration,
        activeGeneration: receipt.activeGeneration,
        freshThroughSequence: receipt.freshThroughSequence,
      });
    case "notDirty":
      return Object.freeze({
        _tag: "notDirty",
        state,
        descriptor: receipt.descriptor,
        activeGeneration: receipt.activeGeneration,
        requestedDirtyThroughSequence:
          receipt.requestedDirtyThroughSequence,
        freshThroughSequence: receipt.freshThroughSequence,
      });
  }
}

function applyDecision(
  receipt: ApplyAdmittedBatchReceipt,
  state: QuerySyncState,
): ApplyInvalidationsDecision {
  switch (receipt._tag) {
    case "duplicate":
      return Object.freeze({
        _tag: "duplicate",
        state,
        observedSequence: receipt.observedSequence,
      });
    case "gap":
      return Object.freeze({
        _tag: "gap",
        state,
        expectedSequence: receipt.expectedSequence,
        observedSequence: receipt.observedSequence,
      });
    case "resetRequired":
      return Object.freeze({
        _tag: "resetRequired",
        state,
        expectedSourceEpoch: receipt.expectedSourceEpoch,
        observedSourceEpoch: receipt.observedSourceEpoch,
      });
    case "applied":
      return Object.freeze({
        _tag: "applied",
        state,
        appliedSequence: receipt.appliedSequence,
        affectedQueryKeys: receipt.affectedQueryKeys,
      });
  }
}

function verifyPlanMetrics(
  operation: "beginQueryEvaluation" | "applyAdmittedInvalidations",
  state: QuerySyncState,
  expected: QuerySyncScopeFacts,
): void {
  if (!querySyncStateMetricsEqual(state.metrics, expected.metrics)) {
    throw transitionInvariant(operation, "transitionPlanMetricsMismatch");
  }
}

export function applyBeginQueryEvaluationTransition(
  state: QuerySyncState,
  request: BeginQueryEvaluationRequest,
): Result.Result<
  AggregateTransition<BeginQueryEvaluationDecision, BeginQueryEvaluationPlan>,
  BeginQueryEvaluationAggregateError
> {
  const query = findQueryState(state, request.target.descriptor.queryKey);
  return planBeginQueryEvaluation({
    scope: projectQuerySyncScopeFacts(state),
    query: projectBeginFacts(query),
    request,
  }).pipe(
    Result.mapError(mapBeginPlannerError),
    Result.flatMap((plan) => {
      if (plan._tag === "noWrite") {
        const transition: AggregateTransition<
          BeginQueryEvaluationDecision,
          BeginQueryEvaluationPlan
        > = Object.freeze({
          decision: beginDecision(plan.receipt, state),
          disposition: "noWrite",
          plan,
        });
        return Result.succeed(transition);
      }
      const current = query;
      const replacement: QueryState = {
        descriptor: plan.change.descriptor,
        active: current?.active ?? null,
        provisional: plan.change.provisional,
        currentCompletion: current?.currentCompletion ?? null,
        precedingCompletionIdentity:
          current?.precedingCompletionIdentity ?? null,
      };
      return rebuildQuerySyncState(state, {
        cursor: plan.nextScope.cursor,
        queries: replaceQuery(state.queries, replacement),
        evaluationWork: plan.nextScope.evaluationWork,
      }).pipe(Result.map((nextState) => {
        verifyPlanMetrics("beginQueryEvaluation", nextState, plan.nextScope);
        const transition: AggregateTransition<
          BeginQueryEvaluationDecision,
          BeginQueryEvaluationPlan
        > = Object.freeze({
          decision: beginDecision(plan.receipt, nextState),
          disposition: "write",
          plan,
        });
        return transition;
      }));
    }),
  );
}

function readAffectedTargets(
  state: QuerySyncState,
  dependencyKeys: readonly CanonicalDependencyKey[],
): AffectedActiveTargetsRead {
  const queryKeys = new Set<CanonicalQueryKey>();
  outer: for (const dependencyKey of dependencyKeys) {
    const entry = findDependencyDirectoryEntry(state, dependencyKey);
    if (entry === undefined) continue;
    for (const queryKey of entry.queryKeys) {
      queryKeys.add(queryKey);
      if (queryKeys.size > MAX_INVALIDATION_AFFECTED_QUERIES) {
        break outer;
      }
    }
  }
  if (queryKeys.size > MAX_INVALIDATION_AFFECTED_QUERIES) {
    return Object.freeze({ _tag: "limitExceeded", observed: 4_097 });
  }
  const ordered = [...queryKeys];
  ordered.sort(compareCanonicalBase64Url);
  const targets: AffectedActiveQueryTarget[] = [];
  for (const queryKey of ordered) {
    const query = findQueryState(state, queryKey);
    if (query?.active === null || query?.active === undefined) {
      throw transitionInvariant(
        "applyAdmittedInvalidations",
        "dependencyDirectoryEntryMissingActiveQuery",
      );
    }
    targets.push(Object.freeze({
      queryKey,
      activeGeneration: query.active.generation,
    }));
  }
  return Object.freeze({
    _tag: "complete",
    targets: Object.freeze(targets),
  });
}

function readAffectedActiveFacts(
  state: QuerySyncState,
  targets: readonly AffectedActiveQueryTarget[],
): readonly AffectedActiveQueryFacts[] {
  return Object.freeze(targets.map((target) => {
    const query = findQueryState(state, target.queryKey);
    if (
      query?.active === null
      || query?.active === undefined
      || query.active.generation !== target.activeGeneration
    ) {
      throw transitionInvariant(
        "applyAdmittedInvalidations",
        "dependencyDirectoryEntryMissingActiveQuery",
      );
    }
    return Object.freeze({
      queryKey: target.queryKey,
      ...projectActiveScalarFacts(query.active),
    });
  }));
}

function applyAdmittedBatchPlan(
  state: QuerySyncState,
  plan: ApplyAdmittedBatchPlan,
): Result.Result<
  AggregateTransition<ApplyInvalidationsDecision, ApplyAdmittedBatchPlan>,
  BuildQuerySyncStateError
> {
  if (plan._tag === "noWrite") {
    return Result.succeed(Object.freeze({
      decision: applyDecision(plan.receipt, state),
      disposition: "noWrite",
      plan,
    }));
  }
  const changes = new Map(plan.change.active.map((change) => (
    [change.expected.queryKey, change] as const
  )));
  const queries = state.queries.map((query) => {
    const change = changes.get(query.descriptor.queryKey);
    if (change === undefined) return query;
    const active = query.active;
    if (
      active === null
      || active.generation !== change.expected.generation
      || active.dirtyThroughSequence
        !== change.expected.dirtyThroughSequence
    ) {
      throw transitionInvariant(
        "applyAdmittedInvalidations",
        "dependencyDirectoryEntryMissingActiveQuery",
      );
    }
    const nextActive: ActiveQueryState = {
      ...active,
      dirtyThroughSequence: change.next.dirtyThroughSequence,
    };
    return {
      descriptor: query.descriptor,
      active: nextActive,
      provisional: query.provisional,
      currentCompletion: query.currentCompletion,
      precedingCompletionIdentity: query.precedingCompletionIdentity,
    };
  });
  return rebuildQuerySyncState(state, {
    cursor: plan.nextScope.cursor,
    queries,
    evaluationWork: plan.nextScope.evaluationWork,
  }).pipe(Result.map((nextState) => {
    verifyPlanMetrics(
      "applyAdmittedInvalidations",
      nextState,
      plan.nextScope,
    );
    return Object.freeze({
      decision: applyDecision(plan.receipt, nextState),
      disposition: "write",
      plan,
    });
  }));
}

export function applyAdmittedInvalidationsTransition(
  state: QuerySyncState,
  batch: AdmittedInvalidationBatch,
): Result.Result<
  AggregateTransition<ApplyInvalidationsDecision, ApplyAdmittedBatchPlan>,
  ApplyAdmittedInvalidationsAggregateError
> {
  const scope = projectQuerySyncScopeFacts(state);
  return startApplyAdmittedBatchAndAdvance({ scope, batch }).pipe(
    Result.mapError(mapApplyPlannerError),
    Result.flatMap((start) => {
      if (start._tag === "planned") {
        return applyAdmittedBatchPlan(state, start.plan);
      }
      const targetRead = readAffectedTargets(
        state,
        start.intent.dependencyKeys,
      );
      return resumeApplyAdmittedBatchAffectedTargets(
        start.resume,
        targetRead,
      ).pipe(
        Result.mapError(mapApplyPlannerError),
        Result.flatMap((next) => {
          if (next._tag === "planned") {
            return applyAdmittedBatchPlan(state, next.plan);
          }
          const facts = readAffectedActiveFacts(
            state,
            next.intent.targets,
          );
          return resumeApplyAdmittedBatchActiveFacts(
            next.resume,
            facts,
          ).pipe(
            Result.mapError(mapApplyPlannerError),
            Result.flatMap((plan) => applyAdmittedBatchPlan(state, plan)),
          );
        }),
      );
    }),
  );
}
