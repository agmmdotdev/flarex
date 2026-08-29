import { Result } from "effect";

import {
  initialQueryGeneration,
  successorQueryGeneration,
  successorQuerySyncWorkRevision,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalQueryKey,
  QueryGeneration,
  QuerySyncWorkRevision,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  InvalidQueryEvaluationRequestError,
  QueryEvaluationWorkBlockedError,
  QueryGenerationExhaustedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
} from "../kernel/Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncStateLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "../kernel/Errors.js";
import type {
  BeginQueryEvaluationRequest,
  ProvisionalQueryState,
  QueryDescriptor,
} from "../kernel/Model.js";
import { validateQuerySyncAuthority } from "../kernel/Authority.js";
import {
  applyMetricReplacement,
  emptyMetricContribution,
  provisionalMetricContribution,
  queryDescriptorMetricContribution,
  validateQuerySyncStateMetrics,
} from "./Accounting.js";
import { QuerySyncTransitionFactError } from "./Errors.js";
import {
  freezeBeginQueryFacts,
  freezeProvisionalFacts,
} from "./Facts.js";
import type {
  BeginQueryFacts,
} from "./Facts.js";
import { validateBeginQueryFacts } from "./LocalInvariants.js";
import { freezeScopeFacts } from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";
import {
  alreadyAdvancedBeginReceipt,
  attemptedBeginReceipt,
  freezeDescriptor,
  notDirtyBeginReceipt,
} from "./Receipts.js";
import type { BeginQueryEvaluationReceipt } from "./Receipts.js";

export type BeginQueryEvaluationQueryExpectation =
  | Readonly<{
      readonly _tag: "absent";
      readonly queryKey: CanonicalQueryKey;
    }>
  | Readonly<{
      readonly _tag: "present";
      readonly queryKey: CanonicalQueryKey;
      readonly facts: BeginQueryFacts;
    }>;

export interface BeginQueryEvaluationExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly query: BeginQueryEvaluationQueryExpectation;
}

export interface BeginQueryEvaluationChange {
  readonly _tag: "replaceBeginQueryEvaluation";
  readonly queryKey: CanonicalQueryKey;
  readonly descriptor: QueryDescriptor;
  readonly provisional: ProvisionalQueryState;
}

export type BeginQueryEvaluationPlan = TransitionPlan<
  BeginQueryEvaluationReceipt,
  BeginQueryEvaluationExpectation,
  BeginQueryEvaluationChange
>;

export type PlanBeginQueryEvaluationError =
  | QuerySyncAuthorityError<"beginQueryEvaluation">
  | QueryGenerationExhaustedError<"beginQueryEvaluation">
  | QueryGenerationMismatchError<"beginQueryEvaluation">
  | QueryKeyCollisionError<"beginQueryEvaluation">
  | InvalidQueryEvaluationRequestError
  | QuerySyncWorkRevisionExhaustedError<"beginQueryEvaluation">
  | QueryEvaluationWorkBlockedError<"beginQueryEvaluation">
  | QuerySyncStateLimitError
  | QuerySyncTransitionFactError;

function invalidEvaluationRequest(
  request: BeginQueryEvaluationRequest,
  reason: InvalidQueryEvaluationRequestError["reason"],
  observedDirtyThroughSequence: SyncSequence | null,
): InvalidQueryEvaluationRequestError {
  return new InvalidQueryEvaluationRequestError({
    operation: "beginQueryEvaluation",
    reason,
    queryKey: request.target.descriptor.queryKey,
    requestedDirtyThroughSequence: request.requestedDirtyThroughSequence,
    observedDirtyThroughSequence,
  });
}

function attemptReceipt(
  tag: "created" | "replayed",
  scope: QuerySyncScopeFacts,
  descriptorInput: QueryDescriptor,
  provisional: ProvisionalQueryState,
): BeginQueryEvaluationReceipt {
  const descriptor = freezeDescriptor(descriptorInput);
  return attemptedBeginReceipt(tag, {
    namespaceId: scope.cursor.namespaceId,
    syncModelId: scope.cursor.syncModelId,
    sourceEpoch: scope.cursor.sourceEpoch,
    descriptor,
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: provisional.registrationCursor,
    requestedDirtyThroughSequence:
      provisional.requestedDirtyThroughSequence,
  });
}

function writePlan(
  scopeInput: QuerySyncScopeFacts,
  queryInput: BeginQueryFacts | null,
  descriptorInput: QueryDescriptor,
  provisionalInput: ProvisionalQueryState,
  receiptTag: "created" | "replayed",
  revision: QuerySyncWorkRevision,
): Result.Result<BeginQueryEvaluationPlan, QuerySyncStateLimitError> {
  const scope = freezeScopeFacts(scopeInput);
  const query = queryInput === null
    ? null
    : freezeBeginQueryFacts(queryInput);
  const provisional = freezeProvisionalFacts(provisionalInput);
  const descriptor = freezeDescriptor(descriptorInput);
  const queryExpectation: BeginQueryEvaluationQueryExpectation = query === null
    ? Object.freeze({
      _tag: "absent",
      queryKey: descriptor.queryKey,
    })
    : Object.freeze({
      _tag: "present",
      queryKey: descriptor.queryKey,
      facts: query,
    });
  let nextMetrics = scope.metrics;
  if (query === null) {
    nextMetrics = applyMetricReplacement(
      nextMetrics,
      emptyMetricContribution(),
      queryDescriptorMetricContribution(descriptor),
    );
  }
  nextMetrics = applyMetricReplacement(
    nextMetrics,
    provisionalMetricContribution(query?.provisional ?? null),
    provisionalMetricContribution(provisional),
  );
  return Result.gen(function* () {
    yield* validateQuerySyncStateMetrics(nextMetrics);
    const nextScope = freezeScopeFacts({
      cursor: scope.cursor,
      evaluationWork: {
        revision,
        fairnessAnchor: scope.evaluationWork.fairnessAnchor,
      },
      metrics: nextMetrics,
    });
    return Object.freeze({
      _tag: "write",
      receipt: attemptReceipt(
        receiptTag,
        nextScope,
        descriptor,
        provisional,
      ),
      expected: Object.freeze({ scope, query: queryExpectation }),
      nextScope,
      change: Object.freeze({
        _tag: "replaceBeginQueryEvaluation",
        queryKey: descriptor.queryKey,
        descriptor,
        provisional,
      }),
    });
  });
}

export function planBeginQueryEvaluation(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly query: BeginQueryFacts | null;
  readonly request: BeginQueryEvaluationRequest;
}): Result.Result<
  BeginQueryEvaluationPlan,
  PlanBeginQueryEvaluationError
> {
  return Result.gen(function* () {
    const scope = freezeScopeFacts(input.scope);
    const request = input.request;
    yield* validateQuerySyncAuthority(
      "beginQueryEvaluation",
      scope.cursor,
      request.target,
    );
    if (
      request.expectedActiveGeneration === null
      && request.requestedDirtyThroughSequence !== null
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "firstRegistrationHasDirtyFrontier",
        null,
      ));
    }
    if (
      request.expectedActiveGeneration !== null
      && request.requestedDirtyThroughSequence === null
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "rerunMissingDirtyFrontier",
        null,
      ));
    }
    if (
      request.requestedDirtyThroughSequence !== null
      && request.requestedDirtyThroughSequence
        > scope.cursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "dirtyFrontierAheadOfCursor",
        null,
      ));
    }
    const query = input.query === null
      ? null
      : freezeBeginQueryFacts(input.query);
    if (
      query !== null
      && query.descriptor.queryKey !== request.target.descriptor.queryKey
    ) {
      return yield* Result.fail(new QuerySyncTransitionFactError({
        operation: "beginQueryEvaluation",
        reason: "queryFactsInvalid",
      }));
    }
    if (
      query !== null
      && query.descriptor.queryIdentity
        !== request.target.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError<
        "beginQueryEvaluation"
      >({
        operation: "beginQueryEvaluation",
        queryKey: request.target.descriptor.queryKey,
      }));
    }
    yield* validateBeginQueryFacts(scope, query);

    const active = query?.active ?? null;
    const descriptor = query?.descriptor ?? request.target.descriptor;
    if (active !== null) {
      const expected = request.expectedActiveGeneration;
      if (expected === null || expected < active.generation) {
        return Object.freeze({
          _tag: "noWrite",
          receipt: alreadyAdvancedBeginReceipt({
            descriptor,
            requestedExpectedActiveGeneration: expected,
            activeGeneration: active.generation,
            freshThroughSequence: active.freshThroughSequence,
          }),
        });
      }
      if (expected > active.generation) {
        return yield* Result.fail(new QueryGenerationMismatchError({
          operation: "beginQueryEvaluation",
          queryKey: descriptor.queryKey,
          expectedGeneration: active.generation,
          observedGeneration: expected,
        }));
      }
      if (request.requestedDirtyThroughSequence === null) {
        return yield* Result.fail(invalidEvaluationRequest(
          request,
          "rerunMissingDirtyFrontier",
          active.dirtyThroughSequence,
        ));
      }
    } else if (request.expectedActiveGeneration !== null) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "beginQueryEvaluation",
        queryKey: descriptor.queryKey,
        expectedGeneration: null,
        observedGeneration: request.expectedActiveGeneration,
      }));
    }

    const provisional = query?.provisional ?? null;
    if (provisional !== null) {
      if (
        provisional.expectedActiveGeneration
        !== request.expectedActiveGeneration
      ) {
        return yield* Result.fail(new QuerySyncTransitionFactError({
          operation: "beginQueryEvaluation",
          reason: "provisionalFenceMismatch",
        }));
      }
      if (provisional.evaluationDisposition._tag === "blocked") {
        return yield* Result.fail(new QueryEvaluationWorkBlockedError<
          "beginQueryEvaluation"
        >({
          operation: "beginQueryEvaluation",
          queryKey: descriptor.queryKey,
          generation: provisional.generation,
          reason: provisional.evaluationDisposition.reason,
          resetRequired: true,
        }));
      }
      if (
        active !== null
        && (
          request.requestedDirtyThroughSequence === null
          || active.dirtyThroughSequence === null
          || request.requestedDirtyThroughSequence
            > active.dirtyThroughSequence
        )
      ) {
        return yield* Result.fail(invalidEvaluationRequest(
          request,
          "dirtyFrontierNotObserved",
          active.dirtyThroughSequence,
        ));
      }
      const observedDirty = active?.dirtyThroughSequence ?? null;
      const currentDirty = provisional.requestedDirtyThroughSequence;
      const coalescedDirty = observedDirty === null
        ? currentDirty
        : currentDirty === null || observedDirty > currentDirty
        ? observedDirty
        : currentDirty;
      if (coalescedDirty === currentDirty) {
        return Object.freeze({
          _tag: "noWrite",
          receipt: attemptReceipt(
            "replayed",
            scope,
            descriptor,
            provisional,
          ),
        });
      }
      const revision = yield* successorQuerySyncWorkRevision(
        "beginQueryEvaluation",
        scope.evaluationWork.revision,
      );
      return yield* writePlan(
        scope,
        query,
        descriptor,
        {
          ...provisional,
          requestedDirtyThroughSequence: coalescedDirty,
        },
        "replayed",
        revision,
      );
    }

    if (
      active !== null
      && request.requestedDirtyThroughSequence !== null
      && request.requestedDirtyThroughSequence
        <= active.freshThroughSequence
    ) {
      return Object.freeze({
        _tag: "noWrite",
        receipt: notDirtyBeginReceipt({
          descriptor,
          activeGeneration: active.generation,
          requestedDirtyThroughSequence:
            request.requestedDirtyThroughSequence,
          freshThroughSequence: active.freshThroughSequence,
        }),
      });
    }
    if (
      active !== null
      && (
        active.dirtyThroughSequence === null
        || request.requestedDirtyThroughSequence === null
        || request.requestedDirtyThroughSequence
          > active.dirtyThroughSequence
      )
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "dirtyFrontierNotObserved",
        active.dirtyThroughSequence,
      ));
    }

    let generation: QueryGeneration;
    if (active === null) {
      generation = initialQueryGeneration();
    } else {
      const successor = successorQueryGeneration(active.generation);
      if (successor === null) {
        return yield* Result.fail(new QueryGenerationExhaustedError({
          operation: "beginQueryEvaluation",
          queryKey: descriptor.queryKey,
          currentGeneration: active.generation,
        }));
      }
      generation = successor;
    }
    const nextProvisional: ProvisionalQueryState = {
      generation,
      expectedActiveGeneration: request.expectedActiveGeneration,
      registrationCursor: scope.cursor,
      requestedDirtyThroughSequence: active?.dirtyThroughSequence ?? null,
      evaluationDisposition: Object.freeze({ _tag: "ready" }),
    };
    const revision = yield* successorQuerySyncWorkRevision(
      "beginQueryEvaluation",
      scope.evaluationWork.revision,
    );
    return yield* writePlan(
      scope,
      query,
      descriptor,
      nextProvisional,
      "created",
      revision,
    );
  });
}
