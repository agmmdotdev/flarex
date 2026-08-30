import { Result } from "effect";

import {
  initialPublicationAttemptOrdinal,
} from "../kernel/CanonicalValue.js";
import type {
  PublicationAttemptInstant,
} from "../kernel/CanonicalValue.js";
import type { QuerySyncStateLimitError } from "../kernel/Errors.js";
import {
  blockedPublicationAttemptDisposition,
  readyPublicationAttemptDisposition,
} from "../kernel/Model.js";
import type {
  InFlightQueryPublication,
} from "../kernel/Model.js";
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import {
  applyMetricReplacement,
  publicationLifecycleMetricContribution,
  retainedPublicationMetricContribution,
  validateQuerySyncStateMetrics,
} from "./Accounting.js";
import {
  QuerySyncTransitionFactError,
  QuerySyncTransitionResumeDefect,
} from "./Errors.js";
import {
  freezeInFlightQueryPublicationFacts,
  freezePendingPublicationSelectionFacts,
  freezePublicationLifecycleFacts,
  freezePublicationOwnerQueryFacts,
  makeInFlightQueryPublication,
} from "./PublicationFacts.js";
import type {
  PendingPublicationSelectionFacts,
  PublicationLifecycleFacts,
  PublicationOwnerQueryFacts,
} from "./PublicationFacts.js";
import {
  clampedPublicationInstant,
  publicationAgeLimitReached,
  validateInFlightPublicationOwnerFacts,
  validatePendingPublicationSelectionFacts,
  validatePublicationLifecycleFacts,
} from "./PublicationInvariants.js";
import {
  blockedClaimPublicationReceipt,
  issuePublicationAttempt,
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
  nonePublicationReceipt,
  attemptedPublicationReceipt,
} from "./PublicationWork.js";
import type {
  ClaimPublicationReceipt,
} from "./PublicationWork.js";
import {
  freezeScopeFacts,
} from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";

export interface ReadClaimPublicationInFlightOwnerFactsIntent {
  readonly _tag: "readClaimPublicationInFlightOwnerFacts";
  readonly identity: QueryPublicationIdentity;
}

export interface ReadLowestPendingPublicationFactsIntent {
  readonly _tag: "readLowestPendingPublicationFacts";
}

export interface ClaimPublicationExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly owner: PublicationOwnerQueryFacts;
  readonly selectedPending: PendingQueryPublication | null;
}

export type ClaimPublicationChange =
  | Readonly<{
      readonly _tag: "blockInFlightPublicationByAge";
      readonly inFlight: InFlightQueryPublication;
    }>
  | Readonly<{
      readonly _tag: "claimPendingPublication";
      readonly publication: PendingQueryPublication;
      readonly inFlight: InFlightQueryPublication;
    }>;

export type ClaimPublicationPlan = TransitionPlan<
  ClaimPublicationReceipt,
  ClaimPublicationExpectation,
  ClaimPublicationChange
>;

interface ClaimPublicationStartState {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly capturedNow: PublicationAttemptInstant;
}

class IssuedClaimPublicationInFlightOwnerResume {
  declare private readonly issuedClaimPublicationInFlightOwnerResume: void;
}

export type ClaimPublicationInFlightOwnerResume =
  IssuedClaimPublicationInFlightOwnerResume;

class IssuedClaimPublicationPendingResume {
  declare private readonly issuedClaimPublicationPendingResume: void;
}

export type ClaimPublicationPendingResume = IssuedClaimPublicationPendingResume;

const inFlightOwnerResumes = new WeakMap<
  IssuedClaimPublicationInFlightOwnerResume,
  ClaimPublicationStartState
>();

const pendingResumes = new WeakMap<
  IssuedClaimPublicationPendingResume,
  ClaimPublicationStartState
>();

export type StartClaimPublicationStep =
  | Readonly<{
      readonly _tag: "read";
      readonly stage: "inFlightOwner";
      readonly intent: ReadClaimPublicationInFlightOwnerFactsIntent;
      readonly resume: ClaimPublicationInFlightOwnerResume;
    }>
  | Readonly<{
      readonly _tag: "read";
      readonly stage: "pending";
      readonly intent: ReadLowestPendingPublicationFactsIntent;
      readonly resume: ClaimPublicationPendingResume;
    }>;

export type StartClaimPublicationError = QuerySyncTransitionFactError;

export type ResumeClaimPublicationInFlightOwnerError =
  QuerySyncTransitionFactError;

export type ResumeClaimPublicationPendingError =
  | QuerySyncStateLimitError
  | QuerySyncTransitionFactError;

function lifecycleFactFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "claimPublication",
    reason: "publicationLifecycleFactsInvalid",
  });
}

function ownerFactFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "claimPublication",
    reason: "publicationOwnerFactsInvalid",
  });
}

function selectionFactFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "claimPublication",
    reason: "publicationSelectionFactsInvalid",
  });
}

function noWritePlan(receipt: ClaimPublicationReceipt): ClaimPublicationPlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function issueInFlightOwnerResume(
  state: ClaimPublicationStartState,
): ClaimPublicationInFlightOwnerResume {
  const resume = new IssuedClaimPublicationInFlightOwnerResume();
  inFlightOwnerResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function issuePendingResume(
  state: ClaimPublicationStartState,
): ClaimPublicationPendingResume {
  const resume = new IssuedClaimPublicationPendingResume();
  pendingResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function inFlightOwnerResumeState(
  resume: ClaimPublicationInFlightOwnerResume,
): ClaimPublicationStartState {
  const state = inFlightOwnerResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "claimPublication",
      stage: "publicationInFlightOwnerFacts",
    });
  }
  return state;
}

function pendingResumeState(
  resume: ClaimPublicationPendingResume,
): ClaimPublicationStartState {
  const state = pendingResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "claimPublication",
      stage: "lowestPendingPublicationFacts",
    });
  }
  return state;
}

function nextScopeWithMetrics(
  scope: QuerySyncScopeFacts,
  metrics: QuerySyncScopeFacts["metrics"],
): QuerySyncScopeFacts {
  return freezeScopeFacts({
    cursor: scope.cursor,
    evaluationWork: scope.evaluationWork,
    metrics,
  });
}

export function startClaimPublication(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly lifecycle: PublicationLifecycleFacts;
  readonly capturedNow: PublicationAttemptInstant;
}): Result.Result<StartClaimPublicationStep, StartClaimPublicationError> {
  const scope = freezeScopeFacts(input.scope);
  const lifecycle = freezePublicationLifecycleFacts(input.lifecycle);
  return Result.gen(function* () {
    yield* validatePublicationLifecycleFacts(
      "claimPublication",
      scope,
      lifecycle,
    );
    const state = Object.freeze({
      scope,
      lifecycle,
      capturedNow: input.capturedNow,
    });
    const inFlight = lifecycle.inFlight;
    if (inFlight !== null) {
      return Object.freeze({
        _tag: "read",
        stage: "inFlightOwner",
        intent: Object.freeze({
          _tag: "readClaimPublicationInFlightOwnerFacts",
          identity: inFlight.publication.identity,
        }),
        resume: issueInFlightOwnerResume(state),
      });
    }
    return Object.freeze({
      _tag: "read",
      stage: "pending",
      intent: Object.freeze({ _tag: "readLowestPendingPublicationFacts" }),
      resume: issuePendingResume(state),
    });
  });
}

export function resumeClaimPublicationInFlightOwner(
  resume: ClaimPublicationInFlightOwnerResume,
  ownerInput: PublicationOwnerQueryFacts | null,
): Result.Result<
  ClaimPublicationPlan,
  ResumeClaimPublicationInFlightOwnerError
> {
  const state = inFlightOwnerResumeState(resume);
  const current = state.lifecycle.inFlight;
  if (current === null) return Result.fail(lifecycleFactFailure());
  if (ownerInput === null) return Result.fail(ownerFactFailure());
  const owner = freezePublicationOwnerQueryFacts(ownerInput);
  return Result.gen(function* () {
    yield* validateInFlightPublicationOwnerFacts(
      state.scope,
      state.lifecycle,
      owner,
    );
    if (current.disposition._tag === "blocked") {
      return noWritePlan(blockedClaimPublicationReceipt(
        current.publication.identity,
        current.attemptOrdinal,
        current.disposition.reason,
      ));
    }
    const clampedNow = clampedPublicationInstant(
      state.capturedNow,
      current.lastAttemptAt,
    );
    if (!publicationAgeLimitReached(
      current.firstAttemptAt,
      clampedNow,
      MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
    )) {
      return noWritePlan(attemptedPublicationReceipt(
        "replayed",
        issuePublicationAttempt(current),
      ));
    }

    const nextInFlight = freezeInFlightQueryPublicationFacts({
      ...current,
      disposition: blockedPublicationAttemptDisposition("ageLimitReached"),
    });
    const nextLifecycle = freezePublicationLifecycleFacts({
      ...state.lifecycle,
      inFlight: nextInFlight,
    });
    const nextMetrics = applyMetricReplacement(
      state.scope.metrics,
      publicationLifecycleMetricContribution(state.lifecycle),
      publicationLifecycleMetricContribution(nextLifecycle),
    );
    return Object.freeze({
      _tag: "write",
      receipt: blockedClaimPublicationReceipt(
        nextInFlight.publication.identity,
        nextInFlight.attemptOrdinal,
        "ageLimitReached",
      ),
      expected: Object.freeze({
        scope: state.scope,
        lifecycle: state.lifecycle,
        owner,
        selectedPending: null,
      }),
      nextScope: nextScopeWithMetrics(state.scope, nextMetrics),
      change: Object.freeze({
        _tag: "blockInFlightPublicationByAge",
        inFlight: nextInFlight,
      }),
    });
  });
}

export function resumeClaimPublicationPending(
  resume: ClaimPublicationPendingResume,
  selectionInput: PendingPublicationSelectionFacts | null,
): Result.Result<ClaimPublicationPlan, ResumeClaimPublicationPendingError> {
  const state = pendingResumeState(resume);
  if (state.lifecycle.inFlight !== null) {
    return Result.fail(lifecycleFactFailure());
  }
  const expectedPendingCount = state.scope.metrics.pendingPublicationCount;
  if (selectionInput === null) {
    return expectedPendingCount === 0
      ? Result.succeed(noWritePlan(nonePublicationReceipt()))
      : Result.fail(selectionFactFailure());
  }
  if (expectedPendingCount === 0) return Result.fail(selectionFactFailure());
  const selection = freezePendingPublicationSelectionFacts(selectionInput);
  return Result.gen(function* () {
    yield* validatePendingPublicationSelectionFacts(
      state.scope,
      state.lifecycle,
      selection,
    );
    const inFlight = makeInFlightQueryPublication({
      publication: selection.publication,
      attemptOrdinal: initialPublicationAttemptOrdinal(),
      firstAttemptAt: state.capturedNow,
      lastAttemptAt: state.capturedNow,
      disposition: readyPublicationAttemptDisposition(),
    });
    const nextLifecycle = freezePublicationLifecycleFacts({
      ...state.lifecycle,
      inFlight,
    });
    let nextMetrics = applyMetricReplacement(
      state.scope.metrics,
      retainedPublicationMetricContribution(selection.publication, "pending"),
      retainedPublicationMetricContribution(selection.publication, "inFlight"),
    );
    nextMetrics = applyMetricReplacement(
      nextMetrics,
      publicationLifecycleMetricContribution(state.lifecycle),
      publicationLifecycleMetricContribution(nextLifecycle),
    );
    yield* validateQuerySyncStateMetrics(nextMetrics);
    const attempt = issuePublicationAttempt(inFlight);
    return Object.freeze({
      _tag: "write",
      receipt: attemptedPublicationReceipt("claimed", attempt),
      expected: Object.freeze({
        scope: state.scope,
        lifecycle: state.lifecycle,
        owner: selection.owner,
        selectedPending: selection.publication,
      }),
      nextScope: nextScopeWithMetrics(state.scope, nextMetrics),
      change: Object.freeze({
        _tag: "claimPendingPublication",
        publication: selection.publication,
        inFlight,
      }),
    });
  });
}
