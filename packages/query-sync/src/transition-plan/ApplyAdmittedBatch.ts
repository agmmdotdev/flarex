import { Result } from "effect";

import {
  compareCanonicalBase64Url,
  successorQuerySyncWorkRevision,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  CanonicalQueryKey,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncStateLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "../kernel/Errors.js";
import { QuerySyncWorkLimitError } from "../kernel/Errors.js";
import type {
  AdmittedInvalidationBatch,
} from "../kernel/Model.js";
import { classifySequenceForOperation } from "../kernel/Sequence.js";
import {
  activeScalarMetricContribution,
  applyMetricReplacement,
  validateQuerySyncStateMetrics,
} from "./Accounting.js";
import {
  QuerySyncTransitionFactError,
  QuerySyncTransitionResumeDefect,
} from "./Errors.js";
import {
  freezeAffectedActiveFacts,
  freezeAffectedActiveTarget,
} from "./Facts.js";
import type {
  AffectedActiveQueryFacts,
  AffectedActiveQueryTarget,
} from "./Facts.js";
import {
  MAX_INVALIDATION_AFFECTED_QUERIES,
  MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
} from "./Limits.js";
import { validateAffectedActiveFacts } from "./LocalInvariants.js";
import {
  freezeScopeFacts,
  plannedStep,
  readStep,
} from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
  TransitionStep,
} from "./Model.js";
import {
  appliedBatchReceipt,
  duplicateApplyReceipt,
  gapApplyReceipt,
  resetRequiredApplyReceipt,
} from "./Receipts.js";
import type { ApplyAdmittedBatchReceipt } from "./Receipts.js";

export interface ReadAffectedActiveTargetsIntent {
  readonly _tag: "readAffectedActiveTargets";
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
  readonly maximumDistinctTargets:
    typeof MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL;
}

export interface ReadAffectedActiveQueryFactsIntent {
  readonly _tag: "readAffectedActiveQueryFacts";
  readonly targets: readonly AffectedActiveQueryTarget[];
}

export type AffectedActiveTargetsRead =
  | Readonly<{
    readonly _tag: "complete";
    readonly targets: readonly AffectedActiveQueryTarget[];
  }>
  | Readonly<{
    readonly _tag: "limitExceeded";
    readonly observed: number;
  }>;

export interface ApplyAdmittedBatchExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly affectedTargets: readonly AffectedActiveQueryTarget[];
  readonly affectedActive: readonly AffectedActiveQueryFacts[];
}

export interface ApplyAdmittedBatchChange {
  readonly _tag: "applyAdmittedBatchAndAdvance";
  readonly active: readonly Readonly<{
    readonly expected: AffectedActiveQueryFacts;
    readonly next: AffectedActiveQueryFacts;
  }>[];
}

export type ApplyAdmittedBatchPlan = TransitionPlan<
  ApplyAdmittedBatchReceipt,
  ApplyAdmittedBatchExpectation,
  ApplyAdmittedBatchChange
>;

interface AffectedTargetsResumeState {
  readonly scope: QuerySyncScopeFacts;
  readonly batch: AdmittedInvalidationBatch;
  readonly nextSequence: SyncSequence;
}

class IssuedAffectedTargetsResume {
  declare private readonly affectedTargetsResume: void;
}

export type ApplyAffectedTargetsResume = IssuedAffectedTargetsResume;

interface AffectedActiveFactsResumeState
  extends AffectedTargetsResumeState {
  readonly targets: readonly AffectedActiveQueryTarget[];
}

class IssuedAffectedActiveFactsResume {
  declare private readonly affectedActiveFactsResume: void;
}

export type ApplyAffectedActiveFactsResume =
  IssuedAffectedActiveFactsResume;

const affectedTargetsResumes = new WeakMap<
  IssuedAffectedTargetsResume,
  AffectedTargetsResumeState
>();
const affectedActiveFactsResumes = new WeakMap<
  IssuedAffectedActiveFactsResume,
  AffectedActiveFactsResumeState
>();

export type StartApplyAdmittedBatchError =
  | QuerySyncNamespaceMismatchError<"applyAdmittedInvalidations">
  | QuerySyncModelMismatchError<"applyAdmittedInvalidations">
  | QuerySyncWorkLimitError<"applyAdmittedInvalidations">;

export type ResumeApplyAffectedTargetsError =
  | QuerySyncWorkLimitError<"applyAdmittedInvalidations">
  | QuerySyncTransitionFactError
  | QuerySyncStateLimitError;

export type ResumeApplyAffectedActiveFactsError =
  | QuerySyncWorkRevisionExhaustedError<"applyAdmittedInvalidations">
  | QuerySyncTransitionFactError
  | QuerySyncStateLimitError;

function workLimit(
  dimension: "dependencyLookups" | "affectedQueries",
  maximum: number,
  observed: number,
): QuerySyncWorkLimitError<"applyAdmittedInvalidations"> {
  return new QuerySyncWorkLimitError<"applyAdmittedInvalidations">({
    operation: "applyAdmittedInvalidations",
    dimension,
    maximum,
    observed,
  });
}

function issueAffectedTargetsResume(
  state: AffectedTargetsResumeState,
): ApplyAffectedTargetsResume {
  const resume = new IssuedAffectedTargetsResume();
  affectedTargetsResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function issueAffectedActiveFactsResume(
  state: AffectedActiveFactsResumeState,
): ApplyAffectedActiveFactsResume {
  const resume = new IssuedAffectedActiveFactsResume();
  affectedActiveFactsResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function affectedTargetsState(
  resume: ApplyAffectedTargetsResume,
): AffectedTargetsResumeState {
  const state = affectedTargetsResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "applyAdmittedInvalidations",
      stage: "affectedTargets",
    });
  }
  return state;
}

function affectedActiveFactsState(
  resume: ApplyAffectedActiveFactsResume,
): AffectedActiveFactsResumeState {
  const state = affectedActiveFactsResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "applyAdmittedInvalidations",
      stage: "affectedActiveFacts",
    });
  }
  return state;
}

function noWriteApplyPlan(
  receipt: ApplyAdmittedBatchReceipt,
): ApplyAdmittedBatchPlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function freezeBatch(
  batch: AdmittedInvalidationBatch,
): AdmittedInvalidationBatch {
  return Object.freeze({
    namespaceId: batch.namespaceId,
    syncModelId: batch.syncModelId,
    sourceEpoch: batch.sourceEpoch,
    sourceSequence: batch.sourceSequence,
    dependencyKeys: Object.freeze([...batch.dependencyKeys]),
  });
}

function targetsAreCanonical(
  targets: readonly AffectedActiveQueryTarget[],
): boolean {
  for (let index = 1; index < targets.length; index += 1) {
    const previous = targets[index - 1];
    const current = targets[index];
    if (
      previous === undefined
      || current === undefined
      || compareCanonicalBase64Url(previous.queryKey, current.queryKey) >= 0
    ) {
      return false;
    }
  }
  return true;
}

function zeroAffectedPlan(
  state: AffectedTargetsResumeState,
): Result.Result<ApplyAdmittedBatchPlan, QuerySyncStateLimitError> {
  const nextScope = freezeScopeFacts({
    cursor: {
      namespaceId: state.scope.cursor.namespaceId,
      syncModelId: state.scope.cursor.syncModelId,
      sourceEpoch: state.scope.cursor.sourceEpoch,
      appliedThroughSequence: state.nextSequence,
    },
    evaluationWork: state.scope.evaluationWork,
    metrics: state.scope.metrics,
  });
  return Result.gen(function* () {
    yield* validateQuerySyncStateMetrics(nextScope.metrics);
    return Object.freeze({
      _tag: "write",
      receipt: appliedBatchReceipt(state.nextSequence, []),
      expected: Object.freeze({
        scope: state.scope,
        affectedTargets: Object.freeze([]),
        affectedActive: Object.freeze([]),
      }),
      nextScope,
      change: Object.freeze({
        _tag: "applyAdmittedBatchAndAdvance",
        active: Object.freeze([]),
      }),
    });
  });
}

export function startApplyAdmittedBatchAndAdvance(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly batch: AdmittedInvalidationBatch;
}): Result.Result<
  TransitionStep<
    ApplyAdmittedBatchPlan,
    ReadAffectedActiveTargetsIntent,
    ApplyAffectedTargetsResume
  >,
  StartApplyAdmittedBatchError
> {
  return Result.gen(function* () {
    const scope = freezeScopeFacts(input.scope);
    const batch = freezeBatch(input.batch);
    const sequence = yield* classifySequenceForOperation(
      "applyAdmittedInvalidations",
      scope.cursor,
      batch,
    );
    switch (sequence._tag) {
      case "duplicate":
        return plannedStep(noWriteApplyPlan(
          duplicateApplyReceipt(sequence.observedSequence),
        ));
      case "gap":
        return plannedStep(noWriteApplyPlan(gapApplyReceipt(
          sequence.expectedSequence,
          sequence.observedSequence,
        )));
      case "resetRequired":
        return plannedStep(noWriteApplyPlan(resetRequiredApplyReceipt(
          sequence.expectedSourceEpoch,
          sequence.observedSourceEpoch,
        )));
      case "exactNext":
        break;
    }
    if (batch.dependencyKeys.length > MAX_INVALIDATION_DEPENDENCY_LOOKUPS) {
      return yield* Result.fail(workLimit(
        "dependencyLookups",
        MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
        batch.dependencyKeys.length,
      ));
    }
    const resumeState = Object.freeze({
      scope,
      batch,
      nextSequence: sequence.nextSequence,
    });
    return readStep(Object.freeze({
      _tag: "readAffectedActiveTargets",
      dependencyKeys: Object.freeze([...batch.dependencyKeys]),
      maximumDistinctTargets: MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
    }), issueAffectedTargetsResume(resumeState));
  });
}

export function resumeApplyAdmittedBatchAffectedTargets(
  resume: ApplyAffectedTargetsResume,
  read: AffectedActiveTargetsRead,
): Result.Result<
  TransitionStep<
    ApplyAdmittedBatchPlan,
    ReadAffectedActiveQueryFactsIntent,
    ApplyAffectedActiveFactsResume
  >,
  ResumeApplyAffectedTargetsError
> {
  const state = affectedTargetsState(resume);
  if (read._tag === "limitExceeded") {
    if (read.observed !== MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL) {
      return Result.fail(new QuerySyncTransitionFactError({
        operation: "applyAdmittedInvalidations",
        reason: "affectedTargetsInvalid",
      }));
    }
    return Result.fail(workLimit(
      "affectedQueries",
      MAX_INVALIDATION_AFFECTED_QUERIES,
      read.observed,
    ));
  }
  const targetsInput = read.targets;
  if (targetsInput.length >= MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL) {
    return Result.fail(new QuerySyncTransitionFactError({
      operation: "applyAdmittedInvalidations",
      reason: "affectedTargetsInvalid",
    }));
  }
  const targets = Object.freeze(targetsInput.map(freezeAffectedActiveTarget));
  if (!targetsAreCanonical(targets)) {
    return Result.fail(new QuerySyncTransitionFactError({
      operation: "applyAdmittedInvalidations",
      reason: "affectedTargetsInvalid",
    }));
  }
  if (targets.length === 0) {
    return zeroAffectedPlan(state).pipe(Result.map(plannedStep));
  }
  const resumeState = Object.freeze({ ...state, targets });
  return Result.succeed(readStep(Object.freeze({
    _tag: "readAffectedActiveQueryFacts",
    targets,
  }), issueAffectedActiveFactsResume(resumeState)));
}

export function resumeApplyAdmittedBatchActiveFacts(
  resume: ApplyAffectedActiveFactsResume,
  factsInput: readonly AffectedActiveQueryFacts[],
): Result.Result<
  ApplyAdmittedBatchPlan,
  ResumeApplyAffectedActiveFactsError
> {
  const state = affectedActiveFactsState(resume);
  if (factsInput.length !== state.targets.length) {
    return Result.fail(new QuerySyncTransitionFactError({
      operation: "applyAdmittedInvalidations",
      reason: "affectedActiveFactsInvalid",
    }));
  }
  const facts = Object.freeze(factsInput.map(freezeAffectedActiveFacts));
  return Result.gen(function* () {
    for (let index = 0; index < state.targets.length; index += 1) {
      const target = state.targets[index];
      const active = facts[index];
      if (
        target === undefined
        || active === undefined
        || active.queryKey !== target.queryKey
        || active.generation !== target.activeGeneration
      ) {
        return yield* Result.fail(new QuerySyncTransitionFactError({
          operation: "applyAdmittedInvalidations",
          reason: "affectedActiveFactsInvalid",
        }));
      }
      yield* validateAffectedActiveFacts(state.scope, active);
    }
    const revision = yield* successorQuerySyncWorkRevision(
      "applyAdmittedInvalidations",
      state.scope.evaluationWork.revision,
    );
    let nextMetrics = state.scope.metrics;
    const changes = facts.map((active) => {
      const next = freezeAffectedActiveFacts({
        ...active,
        dirtyThroughSequence: state.nextSequence,
      });
      nextMetrics = applyMetricReplacement(
        nextMetrics,
        activeScalarMetricContribution(active),
        activeScalarMetricContribution(next),
      );
      return Object.freeze({ expected: active, next });
    });
    yield* validateQuerySyncStateMetrics(nextMetrics);
    const nextScope = freezeScopeFacts({
      cursor: {
        namespaceId: state.scope.cursor.namespaceId,
        syncModelId: state.scope.cursor.syncModelId,
        sourceEpoch: state.scope.cursor.sourceEpoch,
        appliedThroughSequence: state.nextSequence,
      },
      evaluationWork: {
        revision,
        fairnessAnchor: state.scope.evaluationWork.fairnessAnchor,
      },
      metrics: nextMetrics,
    });
    const affectedQueryKeys: readonly CanonicalQueryKey[] = Object.freeze(
      state.targets.map((target) => target.queryKey),
    );
    return Object.freeze({
      _tag: "write",
      receipt: appliedBatchReceipt(
        state.nextSequence,
        affectedQueryKeys,
      ),
      expected: Object.freeze({
        scope: state.scope,
        affectedTargets: state.targets,
        affectedActive: facts,
      }),
      nextScope,
      change: Object.freeze({
        _tag: "applyAdmittedBatchAndAdvance",
        active: Object.freeze(changes),
      }),
    });
  });
}
