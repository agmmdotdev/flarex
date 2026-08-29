import { Result } from "effect";

import {
  successorQuerySyncWorkRevision,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  QueryGeneration,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  InvalidQueryCompletionReplayError,
  InvalidQueryEvidenceError,
  QueryEvaluationWorkBlockedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
} from "../kernel/Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncCanonicalValueError,
  QuerySyncStateLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "../kernel/Errors.js";
import type {
  ActiveQueryState,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryCompletionFingerprint,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
} from "../kernel/Model.js";
import { validateQuerySyncAuthority } from "../kernel/Authority.js";
import {
  captureQueryPublicationArtifact,
  freezePublicationDisposition,
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  unchangedPublicationDisposition,
} from "../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryCompletionPublicationDisposition,
  QueryPublicationArtifact,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import {
  applyMetricReplacement,
  emptyMetricContribution,
  queryMetricContribution,
  retainedPublicationMetricContribution,
  validateQuerySyncStateMetrics,
} from "./Accounting.js";
import type {
  QuerySyncAccountingInput,
  QuerySyncMetricContribution,
} from "./Accounting.js";
import {
  QuerySyncTransitionFactError,
  QuerySyncTransitionResumeDefect,
} from "./Errors.js";
import {
  freezeCompleteQueryMaterialFactsRead,
  freezeCompleteQueryReplayFactsRead,
  freezeCompleteQueryScalarFacts,
} from "./Facts.js";
import type {
  CompleteQueryMaterialFactsRead,
  CompleteQueryReplayFactsRead,
  CompleteQueryScalarFacts,
  CompletionPublicationLifecycleFacts,
  QueryDependencyFacts,
} from "./Facts.js";
import {
  validateCompleteQueryMaterialFacts,
  validateCompleteQueryScalarFacts,
  validateCompleteReplayFacts,
} from "./LocalInvariants.js";
import {
  MAX_QUERY_DEPENDENCY_KEYS,
  MAX_QUERY_DEPENDENCY_SENTINEL,
} from "./Limits.js";
import {
  freezeScopeFacts,
  plannedStep,
} from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";
import {
  completedCompleteReceipt,
  recoveryEvidenceExpiredCompleteReceipt,
  refreshRequiredCompleteReceipt,
  rerunRequiredCompleteReceipt,
  resnapshotRequiredCompleteReceipt,
  supersededCompleteReceipt,
} from "./Receipts.js";
import type { CompleteQueryEvaluationReceipt } from "./Receipts.js";

interface CompletionEvaluationFacts {
  readonly namespaceId: QueryEvaluationEvidence["namespaceId"];
  readonly syncModelId: QueryEvaluationEvidence["syncModelId"];
  readonly sourceEpoch: QueryEvaluationEvidence["sourceEpoch"];
  readonly descriptor: QueryEvaluationEvidence["descriptor"];
  readonly generation: QueryEvaluationEvidence["generation"];
  readonly snapshotSequence: QueryEvaluationEvidence["snapshotSequence"];
  readonly resultDigest: QueryEvaluationEvidence["resultDigest"];
  readonly authorityWitness: QueryEvaluationEvidence["authorityWitness"];
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

interface CompletionRefreshFacts {
  readonly namespaceId: GenerationRefreshEvidence["namespaceId"];
  readonly syncModelId: GenerationRefreshEvidence["syncModelId"];
  readonly sourceEpoch: GenerationRefreshEvidence["sourceEpoch"];
  readonly descriptor: GenerationRefreshEvidence["descriptor"];
  readonly generation: GenerationRefreshEvidence["generation"];
  readonly evaluationSnapshotSequence:
    GenerationRefreshEvidence["evaluationSnapshotSequence"];
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence:
    GenerationRefreshEvidence["refreshedThroughSequence"];
  readonly relevantThroughSequence:
    GenerationRefreshEvidence["relevantThroughSequence"];
  readonly authorityWitness: GenerationRefreshEvidence["authorityWitness"];
}

export interface ReadCompleteQueryReplayFactsIntent {
  readonly _tag: "readCompleteQueryReplayFacts";
  readonly queryKey: CompleteQueryScalarFacts["descriptor"]["queryKey"];
  readonly completionGeneration: QueryGeneration;
  readonly maximumCompletionDependencyMembers:
    typeof MAX_QUERY_DEPENDENCY_SENTINEL;
  readonly retainedPublicationIdentity: QueryPublicationIdentity | null;
}

export interface ReadCompleteQueryMaterialFactsIntent {
  readonly _tag: "readCompleteQueryMaterialFacts";
  readonly queryKey: CompleteQueryScalarFacts["descriptor"]["queryKey"];
  readonly activeGeneration: QueryGeneration | null;
  readonly completionGeneration: QueryGeneration | null;
  readonly maximumActiveDependencyMembers:
    typeof MAX_QUERY_DEPENDENCY_SENTINEL;
  readonly maximumCompletionDependencyMembers:
    typeof MAX_QUERY_DEPENDENCY_SENTINEL;
  readonly pendingPublicationQueryKey:
    CompleteQueryScalarFacts["descriptor"]["queryKey"];
  readonly publicationLifecycleQueryKey:
    CompleteQueryScalarFacts["descriptor"]["queryKey"];
}

export interface CompleteQueryEvaluationExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly query: CompleteQueryScalarFacts;
  readonly activeDependencies: QueryDependencyFacts | null;
  readonly completionDependencies: QueryDependencyFacts | null;
  readonly pendingPublication: PendingQueryPublication | null;
  readonly publicationLifecycle: CompletionPublicationLifecycleFacts;
}

export type CompleteQueryPendingPublicationChange =
  | Readonly<{ readonly _tag: "preserveTargetPending" }>
  | Readonly<{
      readonly _tag: "replaceTargetPending";
      readonly publication: PendingQueryPublication;
    }>;

export interface CompleteQueryEvaluationChange {
  readonly _tag: "replaceCompleteQueryEvaluation";
  readonly queryKey: CompleteQueryScalarFacts["descriptor"]["queryKey"];
  readonly active: ActiveQueryState;
  readonly currentCompletion: QueryCompletionFingerprint;
  readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
  readonly pendingPublication: CompleteQueryPendingPublicationChange;
}

export type CompleteQueryEvaluationPlan = TransitionPlan<
  CompleteQueryEvaluationReceipt,
  CompleteQueryEvaluationExpectation,
  CompleteQueryEvaluationChange
>;

export type CompleteQueryEvaluationStart =
  | Readonly<{
      readonly _tag: "planned";
      readonly plan: CompleteQueryEvaluationPlan;
    }>
  | Readonly<{
      readonly _tag: "read";
      readonly stage: "replay";
      readonly intent: ReadCompleteQueryReplayFactsIntent;
      readonly resume: CompleteQueryReplayResume;
    }>
  | Readonly<{
      readonly _tag: "read";
      readonly stage: "material";
      readonly intent: ReadCompleteQueryMaterialFactsIntent;
      readonly resume: CompleteQueryMaterialResume;
    }>;

interface CompletionResumeState {
  readonly scope: QuerySyncScopeFacts;
  readonly query: CompleteQueryScalarFacts;
  readonly attempt: QueryEvaluationAttempt;
  readonly evaluation: CompletionEvaluationFacts;
  readonly refresh: CompletionRefreshFacts;
  readonly publication: QueryPublicationArtifact;
}

class IssuedCompleteQueryReplayResume {
  declare private readonly completeQueryReplayResume: void;
}

export type CompleteQueryReplayResume = IssuedCompleteQueryReplayResume;

class IssuedCompleteQueryMaterialResume {
  declare private readonly completeQueryMaterialResume: void;
}

export type CompleteQueryMaterialResume = IssuedCompleteQueryMaterialResume;

const replayResumes = new WeakMap<
  IssuedCompleteQueryReplayResume,
  CompletionResumeState
>();
const materialResumes = new WeakMap<
  IssuedCompleteQueryMaterialResume,
  CompletionResumeState
>();

export type StartCompleteQueryEvaluationError =
  | QuerySyncAuthorityError<"completeQueryEvaluation">
  | QueryKeyCollisionError<"completeQueryEvaluation">
  | QueryStateNotFoundError<"completeQueryEvaluation">
  | QueryGenerationMismatchError<"completeQueryEvaluation">
  | InvalidQueryEvidenceError
  | QuerySyncCanonicalValueError
  | QueryEvaluationWorkBlockedError<"completeQueryEvaluation">
  | QuerySyncTransitionFactError;

export type ResumeCompleteQueryReplayError =
  | InvalidQueryCompletionReplayError
  | QuerySyncTransitionFactError;

export type ResumeCompleteQueryMaterialError =
  | QuerySyncWorkRevisionExhaustedError<"completeQueryEvaluation">
  | QuerySyncStateLimitError
  | QuerySyncTransitionFactError;

function invalidQueryEvidence(
  reason: InvalidQueryEvidenceError["reason"],
): InvalidQueryEvidenceError {
  return new InvalidQueryEvidenceError({
    operation: "completeQueryEvaluation",
    reason,
  });
}

function invalidCompletionReplay(
  attempt: QueryEvaluationAttempt,
  reason: InvalidQueryCompletionReplayError["reason"],
): InvalidQueryCompletionReplayError {
  return new InvalidQueryCompletionReplayError({
    operation: "completeQueryEvaluation",
    reason,
    queryKey: attempt.descriptor.queryKey,
    generation: attempt.generation,
  });
}

function dependencyKeysEqual(
  left: readonly CanonicalDependencyKey[],
  right: readonly CanonicalDependencyKey[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function cursorsEqual(left: NamespaceCursor, right: NamespaceCursor): boolean {
  return left.namespaceId === right.namespaceId
    && left.syncModelId === right.syncModelId
    && left.sourceEpoch === right.sourceEpoch
    && left.appliedThroughSequence === right.appliedThroughSequence;
}

function freezeEvaluation(
  evidence: QueryEvaluationEvidence,
): CompletionEvaluationFacts {
  return Object.freeze({
    namespaceId: evidence.namespaceId,
    syncModelId: evidence.syncModelId,
    sourceEpoch: evidence.sourceEpoch,
    descriptor: Object.freeze({
      queryKey: evidence.descriptor.queryKey,
      queryIdentity: evidence.descriptor.queryIdentity,
    }),
    generation: evidence.generation,
    snapshotSequence: evidence.snapshotSequence,
    resultDigest: evidence.resultDigest,
    authorityWitness: evidence.authorityWitness,
    dependencyKeys: Object.freeze([...evidence.dependencyKeys]),
  });
}

function freezeRefresh(
  refresh: GenerationRefreshEvidence,
): CompletionRefreshFacts {
  return Object.freeze({
    namespaceId: refresh.namespaceId,
    syncModelId: refresh.syncModelId,
    sourceEpoch: refresh.sourceEpoch,
    descriptor: Object.freeze({
      queryKey: refresh.descriptor.queryKey,
      queryIdentity: refresh.descriptor.queryIdentity,
    }),
    generation: refresh.generation,
    evaluationSnapshotSequence: refresh.evaluationSnapshotSequence,
    evaluationDependencyKeys:
      Object.freeze([...refresh.evaluationDependencyKeys]),
    refreshedThroughSequence: refresh.refreshedThroughSequence,
    relevantThroughSequence: refresh.relevantThroughSequence,
    authorityWitness: refresh.authorityWitness,
  });
}

function noWriteCompletePlan(
  receipt: CompleteQueryEvaluationReceipt,
): CompleteQueryEvaluationPlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function issueReplayResume(
  state: CompletionResumeState,
): CompleteQueryReplayResume {
  const resume = new IssuedCompleteQueryReplayResume();
  replayResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function issueMaterialResume(
  state: CompletionResumeState,
): CompleteQueryMaterialResume {
  const resume = new IssuedCompleteQueryMaterialResume();
  materialResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function replayResumeState(
  resume: CompleteQueryReplayResume,
): CompletionResumeState {
  const state = replayResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "completeQueryEvaluation",
      stage: "completionReplayFacts",
    });
  }
  return state;
}

function materialResumeState(
  resume: CompleteQueryMaterialResume,
): CompletionResumeState {
  const state = materialResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "completeQueryEvaluation",
      stage: "completionMaterialFacts",
    });
  }
  return state;
}

function completionScalarMatches(
  completion: NonNullable<CompleteQueryScalarFacts["currentCompletion"]>,
  attempt: QueryEvaluationAttempt,
  evaluation: CompletionEvaluationFacts,
  refresh: CompletionRefreshFacts,
  dependencies: readonly CanonicalDependencyKey[],
): boolean {
  return completion.identity.namespaceId === attempt.namespaceId
    && completion.identity.syncModelId === attempt.syncModelId
    && completion.identity.sourceEpoch === attempt.sourceEpoch
    && completion.identity.queryKey === attempt.descriptor.queryKey
    && completion.identity.generation === attempt.generation
    && completion.queryIdentity === attempt.descriptor.queryIdentity
    && completion.expectedActiveGeneration
      === attempt.expectedActiveGeneration
    && cursorsEqual(completion.registrationCursor, attempt.registrationCursor)
    && completion.requestedDirtyThroughSequence
      === attempt.requestedDirtyThroughSequence
    && completion.evaluationSnapshotSequence === evaluation.snapshotSequence
    && dependencyKeysEqual(dependencies, evaluation.dependencyKeys)
    && completion.evaluationAuthorityWitness === evaluation.authorityWitness
    && completion.refreshedThroughSequence
      === refresh.refreshedThroughSequence
    && completion.relevantThroughSequence
      === refresh.relevantThroughSequence
    && completion.refreshAuthorityWitness === refresh.authorityWitness
    && completion.resultDigest === evaluation.resultDigest;
}

function laterRelevantSequence(
  evaluation: CompletionEvaluationFacts,
  refresh: CompletionRefreshFacts,
  active: CompleteQueryScalarFacts["active"],
): SyncSequence | null {
  let relevant = refresh.relevantThroughSequence;
  const dirty = active?.dirtyThroughSequence ?? null;
  if (
    dirty !== null
    && dirty > evaluation.snapshotSequence
    && (relevant === null || dirty > relevant)
  ) {
    relevant = dirty;
  }
  return relevant;
}

function retainedPublicationIdentity(
  completion: NonNullable<CompleteQueryScalarFacts["currentCompletion"]>,
): QueryPublicationIdentity | null {
  return completion.publicationDisposition._tag === "pending"
    ? freezeQueryPublicationIdentity(
      completion.publicationDisposition.identity,
    )
    : null;
}

export function startCompleteQueryEvaluation(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly query: CompleteQueryScalarFacts | null;
  readonly attempt: QueryEvaluationAttempt;
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}): Result.Result<
  CompleteQueryEvaluationStart,
  StartCompleteQueryEvaluationError
> {
  return Result.gen(function* () {
    const scope = freezeScopeFacts(input.scope);
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      scope.cursor,
      input.attempt,
    );
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      scope.cursor,
      input.evaluation,
    );
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      scope.cursor,
      input.refresh,
    );
    if (
      input.attempt.descriptor.queryKey
        !== input.evaluation.descriptor.queryKey
      || input.attempt.descriptor.queryIdentity
        !== input.evaluation.descriptor.queryIdentity
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptEvaluationDescriptorMismatch",
      ));
    }
    if (input.attempt.generation !== input.evaluation.generation) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptEvaluationGenerationMismatch",
      ));
    }
    if (
      input.evaluation.descriptor.queryKey
        !== input.refresh.descriptor.queryKey
      || input.evaluation.descriptor.queryIdentity
        !== input.refresh.descriptor.queryIdentity
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshDescriptorMismatch",
      ));
    }
    if (input.evaluation.generation !== input.refresh.generation) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshGenerationMismatch",
      ));
    }
    if (
      input.evaluation.snapshotSequence
        !== input.refresh.evaluationSnapshotSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshSnapshotMismatch",
      ));
    }
    if (!dependencyKeysEqual(
      input.evaluation.dependencyKeys,
      input.refresh.evaluationDependencyKeys,
    )) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshDependenciesMismatch",
      ));
    }
    const publication = yield* captureQueryPublicationArtifact(
      input.publication,
    );
    if (input.query === null) {
      return yield* Result.fail(new QueryStateNotFoundError({
        operation: "completeQueryEvaluation",
        queryKey: input.attempt.descriptor.queryKey,
      }));
    }
    const query = freezeCompleteQueryScalarFacts(input.query);
    if (query.descriptor.queryKey !== input.attempt.descriptor.queryKey) {
      return yield* Result.fail(new QuerySyncTransitionFactError({
        operation: "completeQueryEvaluation",
        reason: "completeQueryFactsInvalid",
      }));
    }
    if (
      query.descriptor.queryIdentity
        !== input.attempt.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError({
        operation: "completeQueryEvaluation",
        queryKey: input.attempt.descriptor.queryKey,
      }));
    }
    yield* validateCompleteQueryScalarFacts(scope, query);
    const state: CompletionResumeState = Object.freeze({
      scope,
      query,
      attempt: input.attempt,
      evaluation: freezeEvaluation(input.evaluation),
      refresh: freezeRefresh(input.refresh),
      publication,
    });
    const currentCompletion = query.currentCompletion;
    if (
      currentCompletion !== null
      && currentCompletion.identity.generation === input.attempt.generation
    ) {
      const retainedIdentity = retainedPublicationIdentity(currentCompletion);
      return Object.freeze({
        _tag: "read",
        stage: "replay",
        intent: Object.freeze({
          _tag: "readCompleteQueryReplayFacts",
          queryKey: query.descriptor.queryKey,
          completionGeneration: currentCompletion.identity.generation,
          maximumCompletionDependencyMembers:
            MAX_QUERY_DEPENDENCY_SENTINEL,
          retainedPublicationIdentity: retainedIdentity,
        }),
        resume: issueReplayResume(state),
      });
    }
    if (
      query.active !== null
      && input.attempt.generation < query.active.generation
    ) {
      const receipt = query.precedingCompletionIdentity?.generation
          === input.attempt.generation
        ? supersededCompleteReceipt(
          input.attempt.generation,
          query.active.generation,
        )
        : recoveryEvidenceExpiredCompleteReceipt(
          input.attempt.generation,
          query.active.generation,
        );
      return plannedStep(noWriteCompletePlan(receipt));
    }
    const provisional = query.provisional;
    if (provisional?.generation !== input.evaluation.generation) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "completeQueryEvaluation",
        queryKey: input.evaluation.descriptor.queryKey,
        expectedGeneration: provisional?.generation ?? null,
        observedGeneration: input.evaluation.generation,
      }));
    }
    if (provisional.evaluationDisposition._tag === "blocked") {
      return yield* Result.fail(new QueryEvaluationWorkBlockedError({
        operation: "completeQueryEvaluation",
        queryKey: query.descriptor.queryKey,
        generation: provisional.generation,
        reason: provisional.evaluationDisposition.reason,
        resetRequired: true,
      }));
    }
    if (
      provisional.expectedActiveGeneration
        !== input.attempt.expectedActiveGeneration
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptExpectedActiveMismatch",
      ));
    }
    if (!cursorsEqual(
      provisional.registrationCursor,
      input.attempt.registrationCursor,
    )) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptRegistrationCursorMismatch",
      ));
    }
    if (
      provisional.requestedDirtyThroughSequence
        !== input.attempt.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptDirtyFrontierMismatch",
      ));
    }
    if (
      input.evaluation.snapshotSequence
        < provisional.registrationCursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "snapshotBeforeRegistration",
      ));
    }
    if (
      provisional.requestedDirtyThroughSequence !== null
      && input.evaluation.snapshotSequence
        < provisional.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "snapshotBeforeRequestedDirtyFrontier",
      ));
    }
    if (
      input.evaluation.snapshotSequence
        > input.refresh.refreshedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("snapshotAfterRefresh"));
    }
    if (
      input.refresh.refreshedThroughSequence
        > scope.cursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("refreshAheadOfCursor"));
    }
    if (
      input.refresh.relevantThroughSequence !== null
      && input.refresh.relevantThroughSequence
        <= input.evaluation.snapshotSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "relevantNotAfterSnapshot",
      ));
    }
    if (
      input.refresh.relevantThroughSequence !== null
      && input.refresh.relevantThroughSequence
        > input.refresh.refreshedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("relevantAfterRefresh"));
    }
    if (
      input.refresh.refreshedThroughSequence
        < scope.cursor.appliedThroughSequence
    ) {
      return plannedStep(noWriteCompletePlan(refreshRequiredCompleteReceipt(
        input.refresh.refreshedThroughSequence,
        scope.cursor.appliedThroughSequence,
      )));
    }
    if (
      input.evaluation.authorityWitness !== input.refresh.authorityWitness
    ) {
      return plannedStep(noWriteCompletePlan(
        resnapshotRequiredCompleteReceipt(input.evaluation.generation),
      ));
    }
    const relevant = laterRelevantSequence(
      state.evaluation,
      state.refresh,
      query.active,
    );
    if (relevant !== null) {
      return plannedStep(noWriteCompletePlan(rerunRequiredCompleteReceipt(
        input.evaluation.generation,
        relevant,
      )));
    }
    return Object.freeze({
      _tag: "read",
      stage: "material",
      intent: Object.freeze({
        _tag: "readCompleteQueryMaterialFacts",
        queryKey: query.descriptor.queryKey,
        activeGeneration: query.active?.generation ?? null,
        completionGeneration:
          query.currentCompletion?.identity.generation ?? null,
        maximumActiveDependencyMembers: MAX_QUERY_DEPENDENCY_SENTINEL,
        maximumCompletionDependencyMembers: MAX_QUERY_DEPENDENCY_SENTINEL,
        pendingPublicationQueryKey: query.descriptor.queryKey,
        publicationLifecycleQueryKey: query.descriptor.queryKey,
      }),
      resume: issueMaterialResume(state),
    });
  });
}

export function resumeCompleteQueryEvaluationReplay(
  resume: CompleteQueryReplayResume,
  readInput: CompleteQueryReplayFactsRead,
): Result.Result<
  CompleteQueryEvaluationPlan,
  ResumeCompleteQueryReplayError
> {
  const state = replayResumeState(resume);
  if (
    readInput.completionDependencies.dependencyKeys.length
      > MAX_QUERY_DEPENDENCY_KEYS
  ) {
    return Result.fail(new QuerySyncTransitionFactError({
      operation: "completeQueryEvaluation",
      reason: "completionDependenciesInvalid",
    }));
  }
  const read = freezeCompleteQueryReplayFactsRead(readInput);
  return Result.gen(function* () {
    yield* validateCompleteReplayFacts(
      state.scope,
      state.query,
      read,
    );
    const completion = state.query.currentCompletion;
    if (completion === null) {
      return yield* Result.fail(new QuerySyncTransitionFactError({
        operation: "completeQueryEvaluation",
        reason: "completionDependenciesInvalid",
      }));
    }
    if (!completionScalarMatches(
      completion,
      state.attempt,
      state.evaluation,
      state.refresh,
      read.completionDependencies.dependencyKeys,
    )) {
      return yield* Result.fail(invalidCompletionReplay(
        state.attempt,
        "fingerprintMismatch",
      ));
    }
    if (
      completion.publicationDisposition._tag === "pending"
      && read.retainedPublication !== null
      && read.retainedPublication.content !== state.publication.content
    ) {
      return yield* Result.fail(invalidCompletionReplay(
        state.attempt,
        "publicationContentMismatch",
      ));
    }
    return noWriteCompletePlan(completedCompleteReceipt(
      "replayed",
      state.attempt.generation,
      completion.publicationDisposition,
    ));
  });
}

function materialActive(
  state: CompletionResumeState,
): ActiveQueryState {
  return Object.freeze({
    generation: state.evaluation.generation,
    evaluationSnapshotSequence: state.evaluation.snapshotSequence,
    freshThroughSequence: state.refresh.refreshedThroughSequence,
    dirtyThroughSequence: null,
    resultDigest: state.evaluation.resultDigest,
    authorityWitness: state.refresh.authorityWitness,
    dependencyKeys: Object.freeze([...state.evaluation.dependencyKeys]),
  });
}

function materialCompletion(
  state: CompletionResumeState,
  disposition: QueryCompletionPublicationDisposition,
): QueryCompletionFingerprint {
  const identity = makeQueryPublicationIdentity({
    namespaceId: state.scope.cursor.namespaceId,
    syncModelId: state.scope.cursor.syncModelId,
    sourceEpoch: state.scope.cursor.sourceEpoch,
    queryKey: state.query.descriptor.queryKey,
    generation: state.evaluation.generation,
  });
  return Object.freeze({
    identity,
    queryIdentity: state.query.descriptor.queryIdentity,
    expectedActiveGeneration: state.attempt.expectedActiveGeneration,
    registrationCursor: Object.freeze({
      namespaceId: state.attempt.registrationCursor.namespaceId,
      syncModelId: state.attempt.registrationCursor.syncModelId,
      sourceEpoch: state.attempt.registrationCursor.sourceEpoch,
      appliedThroughSequence:
        state.attempt.registrationCursor.appliedThroughSequence,
    }),
    requestedDirtyThroughSequence:
      state.attempt.requestedDirtyThroughSequence,
    evaluationSnapshotSequence: state.evaluation.snapshotSequence,
    evaluationDependencyKeys:
      Object.freeze([...state.evaluation.dependencyKeys]),
    evaluationAuthorityWitness: state.evaluation.authorityWitness,
    refreshedThroughSequence: state.refresh.refreshedThroughSequence,
    relevantThroughSequence: state.refresh.relevantThroughSequence,
    refreshAuthorityWitness: state.refresh.authorityWitness,
    resultDigest: state.evaluation.resultDigest,
    publicationDisposition: freezePublicationDisposition(disposition),
  });
}

function materialBeforeQuery(
  state: CompletionResumeState,
  read: CompleteQueryMaterialFactsRead,
): QuerySyncAccountingInput["queries"][number] {
  const active = state.query.active === null
    ? null
    : Object.freeze({
      ...state.query.active,
      dependencyKeys:
        read.activeDependencies?.dependencyKeys ?? Object.freeze([]),
    });
  const completion = state.query.currentCompletion === null
    ? null
    : Object.freeze({
      ...state.query.currentCompletion,
      evaluationDependencyKeys:
        read.completionDependencies?.dependencyKeys ?? Object.freeze([]),
    });
  return Object.freeze({
    descriptor: state.query.descriptor,
    active,
    provisional: state.query.provisional,
    currentCompletion: completion,
    precedingCompletionIdentity: state.query.precedingCompletionIdentity,
  });
}

function publicationContribution(
  publication: PendingQueryPublication | null,
): QuerySyncMetricContribution {
  return publication === null
    ? emptyMetricContribution()
    : retainedPublicationMetricContribution(publication, "pending");
}

export function resumeCompleteQueryEvaluationMaterial(
  resume: CompleteQueryMaterialResume,
  readInput: CompleteQueryMaterialFactsRead,
): Result.Result<
  CompleteQueryEvaluationPlan,
  ResumeCompleteQueryMaterialError
> {
  const state = materialResumeState(resume);
  if (
    readInput.activeDependencies !== null
    && readInput.activeDependencies.dependencyKeys.length
      > MAX_QUERY_DEPENDENCY_KEYS
  ) {
    return Result.fail(new QuerySyncTransitionFactError({
      operation: "completeQueryEvaluation",
      reason: "activeDependenciesInvalid",
    }));
  }
  if (
    readInput.completionDependencies !== null
    && readInput.completionDependencies.dependencyKeys.length
      > MAX_QUERY_DEPENDENCY_KEYS
  ) {
    return Result.fail(new QuerySyncTransitionFactError({
      operation: "completeQueryEvaluation",
      reason: "completionDependenciesInvalid",
    }));
  }
  const read = freezeCompleteQueryMaterialFactsRead(readInput);
  return Result.gen(function* () {
    yield* validateCompleteQueryMaterialFacts(
      state.scope,
      state.query,
      read,
    );
    const revision = yield* successorQuerySyncWorkRevision(
      "completeQueryEvaluation",
      state.scope.evaluationWork.revision,
    );
    const nextActive = materialActive(state);
    const shouldPublish = state.query.active === null
      || state.query.active.resultDigest !== state.evaluation.resultDigest;
    const identity = makeQueryPublicationIdentity({
      namespaceId: state.scope.cursor.namespaceId,
      syncModelId: state.scope.cursor.syncModelId,
      sourceEpoch: state.scope.cursor.sourceEpoch,
      queryKey: state.query.descriptor.queryKey,
      generation: state.evaluation.generation,
    });
    const disposition = shouldPublish
      ? pendingPublicationDisposition(identity)
      : unchangedPublicationDisposition();
    const nextCompletion = materialCompletion(state, disposition);
    const replacementPending = shouldPublish
      ? makePendingQueryPublication({
        identity,
        queryIdentity: state.query.descriptor.queryIdentity,
        completedThroughSequence: state.refresh.refreshedThroughSequence,
        resultDigest: state.evaluation.resultDigest,
        content: state.publication.content,
      })
      : null;
    const beforeQuery = materialBeforeQuery(state, read);
    const afterQuery = Object.freeze({
      descriptor: state.query.descriptor,
      active: nextActive,
      provisional: null,
      currentCompletion: nextCompletion,
      precedingCompletionIdentity:
        state.query.currentCompletion?.identity ?? null,
    });
    let nextMetrics = applyMetricReplacement(
      state.scope.metrics,
      queryMetricContribution(beforeQuery),
      queryMetricContribution(afterQuery),
    );
    if (shouldPublish) {
      nextMetrics = applyMetricReplacement(
        nextMetrics,
        publicationContribution(read.pendingPublication),
        publicationContribution(replacementPending),
      );
    }
    yield* validateQuerySyncStateMetrics(nextMetrics);
    const nextScope = freezeScopeFacts({
      cursor: state.scope.cursor,
      evaluationWork: {
        revision,
        fairnessAnchor: state.scope.evaluationWork.fairnessAnchor,
      },
      metrics: nextMetrics,
    });
    const pendingChange: CompleteQueryPendingPublicationChange =
      replacementPending !== null
      ? Object.freeze({
        _tag: "replaceTargetPending",
        publication: replacementPending,
      })
      : Object.freeze({ _tag: "preserveTargetPending" });
    return Object.freeze({
      _tag: "write",
      receipt: completedCompleteReceipt(
        "completed",
        state.evaluation.generation,
        disposition,
      ),
      expected: Object.freeze({
        scope: state.scope,
        query: state.query,
        activeDependencies: read.activeDependencies,
        completionDependencies: read.completionDependencies,
        pendingPublication: read.pendingPublication,
        publicationLifecycle: read.lifecycle,
      }),
      nextScope,
      change: Object.freeze({
        _tag: "replaceCompleteQueryEvaluation",
        queryKey: state.query.descriptor.queryKey,
        active: nextActive,
        currentCompletion: nextCompletion,
        precedingCompletionIdentity:
          state.query.currentCompletion === null
            ? null
            : freezeQueryPublicationIdentity(
              state.query.currentCompletion.identity,
            ),
        pendingPublication: pendingChange,
      }),
    });
  });
}
