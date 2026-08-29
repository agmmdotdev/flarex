import { Result } from "effect";

import { compareCanonicalBase64Url } from "../../kernel/CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  CanonicalQueryKey,
  QueryGeneration,
} from "../../kernel/CanonicalValue.js";
import { QuerySyncInvariantDefect } from "../../kernel/Errors.js";
import { buildQuerySyncState } from "../../kernel/Model.js";
import type {
  AdmittedInvalidationBatch,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  ProvisionalQueryState,
  QueryCompletionFingerprint,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QuerySyncPublicationWorkState,
  QuerySyncState,
} from "../../kernel/Model.js";
import {
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
  queryPublicationIdentityEquals,
} from "../../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryPublicationArtifact,
  QueryPublicationIdentity,
} from "../../kernel/Publication.js";
import {
  planBeginQueryEvaluation,
} from "../../transition-plan/BeginQueryEvaluation.js";
import type {
  BeginQueryEvaluationPlan,
  PlanBeginQueryEvaluationError,
} from "../../transition-plan/BeginQueryEvaluation.js";
import {
  resumeCompleteQueryEvaluationMaterial,
  resumeCompleteQueryEvaluationReplay,
  startCompleteQueryEvaluation,
} from "../../transition-plan/CompleteQueryEvaluation.js";
import type {
  CompleteQueryEvaluationPlan,
  ReadCompleteQueryMaterialFactsIntent,
  ReadCompleteQueryReplayFactsIntent,
  ResumeCompleteQueryMaterialError,
  ResumeCompleteQueryReplayError,
  StartCompleteQueryEvaluationError,
} from "../../transition-plan/CompleteQueryEvaluation.js";
import type {
  ClaimEvaluationWorkReceipt,
  EvaluationAttemptOutcome,
  EvaluationWorkScanRequest,
  RecordEvaluationAttemptOutcomeReceipt,
} from "../../transition-plan/EvaluationWork.js";
import {
  resumeClaimEvaluationWorkScan,
  resumeClaimEvaluationWorkSelectedQuery,
  startClaimEvaluationWork,
} from "../../transition-plan/ClaimEvaluationWork.js";
import type {
  ClaimEvaluationWorkPlan,
  EvaluationSelectedQueryFacts,
  EvaluationWorkScanFacts,
  EvaluationWorkScanFactsRead,
  ReadEvaluationWorkScanFactsIntent,
  ResumeClaimEvaluationWorkScanError,
  ResumeClaimEvaluationWorkSelectedQueryError,
  StartClaimEvaluationWorkError,
} from "../../transition-plan/ClaimEvaluationWork.js";
import {
  authenticateRecordEvaluationAttemptOutcomeAttempt,
  planRecordEvaluationAttemptOutcome,
} from "../../transition-plan/RecordEvaluationAttemptOutcome.js";
import type {
  EvaluationAttemptCompletionFacts,
  EvaluationAttemptOutcomeQueryFacts,
  PlanRecordEvaluationAttemptOutcomeError,
  RecordEvaluationAttemptOutcomePlan,
} from "../../transition-plan/RecordEvaluationAttemptOutcome.js";
import {
  resumeApplyAdmittedBatchActiveFacts,
  resumeApplyAdmittedBatchAffectedTargets,
  startApplyAdmittedBatchAndAdvance,
} from "../../transition-plan/ApplyAdmittedBatch.js";
import type {
  AffectedActiveTargetsRead,
  ApplyAdmittedBatchPlan,
  ResumeApplyAffectedActiveFactsError,
  ResumeApplyAffectedTargetsError,
  StartApplyAdmittedBatchError,
} from "../../transition-plan/ApplyAdmittedBatch.js";
import {
  freezeActiveScalarFacts,
  freezeBeginQueryFacts,
  freezeCompleteQueryMaterialFactsRead,
  freezeCompleteQueryReplayFactsRead,
  freezeCompleteQueryScalarFacts,
  freezeProvisionalFacts,
  freezeQueryCompletionScalarFacts,
  projectActiveScalarFacts,
} from "../../transition-plan/Facts.js";
import type {
  ActiveQueryScalarFacts,
  AffectedActiveQueryFacts,
  AffectedActiveQueryTarget,
  BeginQueryFacts,
  CompleteQueryMaterialFactsRead,
  CompleteQueryReplayFactsRead,
  CompleteQueryScalarFacts,
  CompletionPublicationLifecycleFacts,
  QueryCompletionScalarFacts,
  QueryDependencyFacts,
} from "../../transition-plan/Facts.js";
import {
  MAX_INVALIDATION_AFFECTED_QUERIES,
  MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
  MAX_QUERY_DEPENDENCY_SENTINEL,
} from "../../transition-plan/Limits.js";
import {
  freezeScopeFacts,
  querySyncStateMetricsEqual,
} from "../../transition-plan/Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionDisposition,
} from "../../transition-plan/Model.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  CompleteQueryEvaluationReceipt,
} from "../../transition-plan/Receipts.js";

type NormalizedCompletionScalarFacts = QueryCompletionScalarFacts;

interface NormalizedQueryRow {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryScalarFacts | null;
  readonly provisional: ProvisionalQueryState | null;
  readonly currentCompletion: NormalizedCompletionScalarFacts | null;
  readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
}

interface NormalizedActiveDependencyRow {
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
  readonly dependencyKey: CanonicalDependencyKey;
}

interface NormalizedCompletionDependencyRow {
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
  readonly dependencyKey: CanonicalDependencyKey;
}

export interface NormalizedQuerySyncState {
  readonly scope: QuerySyncScopeFacts;
  readonly queries: readonly NormalizedQueryRow[];
  readonly activeDependencies: readonly NormalizedActiveDependencyRow[];
  readonly completionDependencies:
    readonly NormalizedCompletionDependencyRow[];
  readonly publicationWork: QuerySyncPublicationWorkState;
}

export interface NormalizedTransition<Receipt, Plan> {
  readonly receipt: Receipt;
  readonly state: QuerySyncState;
  readonly disposition: TransitionDisposition;
  readonly plan: Plan;
}

export type NormalizedBeginError =
  | PlanBeginQueryEvaluationError
  | BuildQuerySyncStateError;

export type NormalizedApplyError =
  | StartApplyAdmittedBatchError
  | ResumeApplyAffectedTargetsError
  | ResumeApplyAffectedActiveFactsError
  | BuildQuerySyncStateError;

export type NormalizedCompleteError =
  | StartCompleteQueryEvaluationError
  | ResumeCompleteQueryReplayError
  | ResumeCompleteQueryMaterialError
  | BuildQuerySyncStateError;

export type NormalizedRecordEvaluationAttemptOutcomeError =
  | PlanRecordEvaluationAttemptOutcomeError
  | BuildQuerySyncStateError;

export type NormalizedClaimEvaluationWorkError =
  | StartClaimEvaluationWorkError
  | ResumeClaimEvaluationWorkScanError
  | ResumeClaimEvaluationWorkSelectedQueryError
  | BuildQuerySyncStateError;

type NormalizedOperation =
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "claimEvaluationWork"
  | "completeQueryEvaluation"
  | "recordEvaluationAttemptOutcome";

function transitionDefect(
  operation: NormalizedOperation,
): QuerySyncInvariantDefect {
  return new QuerySyncInvariantDefect({
    operation,
    invariant: "transitionPlanUnexpectedStep",
  });
}

function freezeDescriptor(
  descriptor: QueryDescriptor,
): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

function freezeCompletionScalarFacts(
  completion: QueryCompletionFingerprint,
): NormalizedCompletionScalarFacts {
  return freezeQueryCompletionScalarFacts(completion);
}

export function normalizeQuerySyncState(
  state: QuerySyncState,
): NormalizedQuerySyncState {
  const queries = state.queries.map((query): NormalizedQueryRow => (
    Object.freeze({
      descriptor: freezeDescriptor(query.descriptor),
      active: query.active === null
        ? null
        : projectActiveScalarFacts(query.active),
      provisional: query.provisional === null
        ? null
        : freezeProvisionalFacts(query.provisional),
      currentCompletion: query.currentCompletion === null
        ? null
        : freezeCompletionScalarFacts(query.currentCompletion),
      precedingCompletionIdentity: query.precedingCompletionIdentity,
    })
  ));
  const activeDependencies: NormalizedActiveDependencyRow[] = [];
  const completionDependencies: NormalizedCompletionDependencyRow[] = [];
  for (const query of state.queries) {
    if (query.active !== null) {
      for (const dependencyKey of query.active.dependencyKeys) {
        activeDependencies.push(Object.freeze({
          queryKey: query.descriptor.queryKey,
          generation: query.active.generation,
          dependencyKey,
        }));
      }
    }
    if (query.currentCompletion !== null) {
      for (
        const dependencyKey of
        query.currentCompletion.evaluationDependencyKeys
      ) {
        completionDependencies.push(Object.freeze({
          queryKey: query.descriptor.queryKey,
          generation: query.currentCompletion.identity.generation,
          dependencyKey,
        }));
      }
    }
  }
  activeDependencies.sort((left, right) => {
    const queryOrder = compareCanonicalBase64Url(
      left.queryKey,
      right.queryKey,
    );
    return queryOrder !== 0
      ? queryOrder
      : compareCanonicalBase64Url(
        left.dependencyKey,
        right.dependencyKey,
      );
  });
  completionDependencies.sort((left, right) => {
    const queryOrder = compareCanonicalBase64Url(
      left.queryKey,
      right.queryKey,
    );
    return queryOrder !== 0
      ? queryOrder
      : compareCanonicalBase64Url(
        left.dependencyKey,
        right.dependencyKey,
      );
  });
  return Object.freeze({
    scope: freezeScopeFacts({
      cursor: state.cursor,
      evaluationWork: state.evaluationWork,
      metrics: state.metrics,
    }),
    queries: Object.freeze(queries),
    activeDependencies: Object.freeze(activeDependencies),
    completionDependencies: Object.freeze(completionDependencies),
    publicationWork: state.publicationWork,
  });
}

function findNormalizedQuery(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): NormalizedQueryRow | undefined {
  return normalized.queries.find((query) => (
    query.descriptor.queryKey === queryKey
  ));
}

function scopeFactsEqual(
  left: QuerySyncScopeFacts,
  right: QuerySyncScopeFacts,
): boolean {
  return left.cursor.namespaceId === right.cursor.namespaceId
    && left.cursor.syncModelId === right.cursor.syncModelId
    && left.cursor.sourceEpoch === right.cursor.sourceEpoch
    && left.cursor.appliedThroughSequence
      === right.cursor.appliedThroughSequence
    && left.evaluationWork.revision === right.evaluationWork.revision
    && left.evaluationWork.fairnessAnchor
      === right.evaluationWork.fairnessAnchor
    && querySyncStateMetricsEqual(left.metrics, right.metrics);
}

function activeFactsEqual(
  left: ActiveQueryScalarFacts,
  right: ActiveQueryScalarFacts,
): boolean {
  return left.generation === right.generation
    && left.evaluationSnapshotSequence === right.evaluationSnapshotSequence
    && left.freshThroughSequence === right.freshThroughSequence
    && left.dirtyThroughSequence === right.dirtyThroughSequence
    && left.resultDigest === right.resultDigest
    && left.authorityWitness === right.authorityWitness;
}

function affectedActiveFactsEqual(
  left: AffectedActiveQueryFacts,
  right: AffectedActiveQueryFacts,
): boolean {
  return left.queryKey === right.queryKey && activeFactsEqual(left, right);
}

function provisionalFactsEqual(
  left: ProvisionalQueryState,
  right: ProvisionalQueryState,
): boolean {
  if (
    left.generation !== right.generation
    || left.expectedActiveGeneration !== right.expectedActiveGeneration
    || left.requestedDirtyThroughSequence
      !== right.requestedDirtyThroughSequence
    || left.registrationCursor.namespaceId
      !== right.registrationCursor.namespaceId
    || left.registrationCursor.syncModelId
      !== right.registrationCursor.syncModelId
    || left.registrationCursor.sourceEpoch
      !== right.registrationCursor.sourceEpoch
    || left.registrationCursor.appliedThroughSequence
      !== right.registrationCursor.appliedThroughSequence
    || left.evaluationDisposition._tag
      !== right.evaluationDisposition._tag
  ) {
    return false;
  }
  if (
    left.evaluationDisposition._tag === "blocked"
    && right.evaluationDisposition._tag === "blocked"
  ) {
    return left.evaluationDisposition.reason
      === right.evaluationDisposition.reason
      && left.evaluationDisposition.resetRequired
        === right.evaluationDisposition.resetRequired;
  }
  return true;
}

function beginQueryFactsEqual(
  left: BeginQueryFacts | null,
  right: BeginQueryFacts | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.descriptor.queryKey !== right.descriptor.queryKey
    || left.descriptor.queryIdentity !== right.descriptor.queryIdentity
  ) {
    return false;
  }
  if (left.active === null || right.active === null) {
    if (left.active !== right.active) return false;
  } else if (!activeFactsEqual(left.active, right.active)) {
    return false;
  }
  if (left.provisional === null || right.provisional === null) {
    return left.provisional === right.provisional;
  }
  return provisionalFactsEqual(left.provisional, right.provisional);
}

function identityEqual(
  left: QueryPublicationIdentity | null,
  right: QueryPublicationIdentity | null,
): boolean {
  if (left === null || right === null) return left === right;
  return queryPublicationIdentityEquals(left, right);
}

function completionFactsEqual(
  left: QueryCompletionScalarFacts | null,
  right: QueryCompletionScalarFacts | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    !queryPublicationIdentityEquals(left.identity, right.identity)
    || left.queryIdentity !== right.queryIdentity
    || left.expectedActiveGeneration !== right.expectedActiveGeneration
    || left.registrationCursor.namespaceId
      !== right.registrationCursor.namespaceId
    || left.registrationCursor.syncModelId
      !== right.registrationCursor.syncModelId
    || left.registrationCursor.sourceEpoch
      !== right.registrationCursor.sourceEpoch
    || left.registrationCursor.appliedThroughSequence
      !== right.registrationCursor.appliedThroughSequence
    || left.requestedDirtyThroughSequence
      !== right.requestedDirtyThroughSequence
    || left.evaluationSnapshotSequence !== right.evaluationSnapshotSequence
    || left.evaluationAuthorityWitness
      !== right.evaluationAuthorityWitness
    || left.refreshedThroughSequence !== right.refreshedThroughSequence
    || left.relevantThroughSequence !== right.relevantThroughSequence
    || left.refreshAuthorityWitness !== right.refreshAuthorityWitness
    || left.resultDigest !== right.resultDigest
    || left.publicationDisposition._tag
      !== right.publicationDisposition._tag
  ) {
    return false;
  }
  return left.publicationDisposition._tag === "unchanged"
    || (
      right.publicationDisposition._tag === "pending"
      && queryPublicationIdentityEquals(
        left.publicationDisposition.identity,
        right.publicationDisposition.identity,
      )
    );
}

function completeQueryFactsEqual(
  left: CompleteQueryScalarFacts | null,
  right: CompleteQueryScalarFacts | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.descriptor.queryKey !== right.descriptor.queryKey
    || left.descriptor.queryIdentity !== right.descriptor.queryIdentity
  ) {
    return false;
  }
  if (left.active === null || right.active === null) {
    if (left.active !== right.active) return false;
  } else if (!activeFactsEqual(left.active, right.active)) {
    return false;
  }
  if (left.provisional === null || right.provisional === null) {
    if (left.provisional !== right.provisional) return false;
  } else if (!provisionalFactsEqual(left.provisional, right.provisional)) {
    return false;
  }
  return completionFactsEqual(
    left.currentCompletion,
    right.currentCompletion,
  ) && identityEqual(
    left.precedingCompletionIdentity,
    right.precedingCompletionIdentity,
  );
}

function evaluationAttemptCompletionFacts(
  completion: NormalizedCompletionScalarFacts,
): EvaluationAttemptCompletionFacts {
  return Object.freeze({
    identity: completion.identity,
    queryIdentity: completion.queryIdentity,
    expectedActiveGeneration: completion.expectedActiveGeneration,
    registrationCursor: completion.registrationCursor,
    requestedDirtyThroughSequence:
      completion.requestedDirtyThroughSequence,
  });
}

function evaluationAttemptOutcomeFacts(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): EvaluationAttemptOutcomeQueryFacts | null {
  const query = findNormalizedQuery(normalized, queryKey);
  if (query === undefined) return null;
  return Object.freeze({
    descriptor: query.descriptor,
    active: query.active,
    provisional: query.provisional,
    currentCompletion: query.currentCompletion === null
      ? null
      : evaluationAttemptCompletionFacts(query.currentCompletion),
    precedingCompletionIdentity: query.precedingCompletionIdentity,
  });
}

function evaluationAttemptCompletionFactsEqual(
  left: EvaluationAttemptCompletionFacts | null,
  right: EvaluationAttemptCompletionFacts | null,
): boolean {
  if (left === null || right === null) return left === right;
  return queryPublicationIdentityEquals(left.identity, right.identity)
    && left.queryIdentity === right.queryIdentity
    && left.expectedActiveGeneration === right.expectedActiveGeneration
    && left.registrationCursor.namespaceId
      === right.registrationCursor.namespaceId
    && left.registrationCursor.syncModelId
      === right.registrationCursor.syncModelId
    && left.registrationCursor.sourceEpoch
      === right.registrationCursor.sourceEpoch
    && left.registrationCursor.appliedThroughSequence
      === right.registrationCursor.appliedThroughSequence
    && left.requestedDirtyThroughSequence
      === right.requestedDirtyThroughSequence;
}

function evaluationAttemptOutcomeFactsEqual(
  left: EvaluationAttemptOutcomeQueryFacts | null,
  right: EvaluationAttemptOutcomeQueryFacts | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.descriptor.queryKey !== right.descriptor.queryKey
    || left.descriptor.queryIdentity !== right.descriptor.queryIdentity
  ) {
    return false;
  }
  if (left.active === null || right.active === null) {
    if (left.active !== right.active) return false;
  } else if (!activeFactsEqual(left.active, right.active)) {
    return false;
  }
  if (left.provisional === null || right.provisional === null) {
    if (left.provisional !== right.provisional) return false;
  } else if (!provisionalFactsEqual(left.provisional, right.provisional)) {
    return false;
  }
  return evaluationAttemptCompletionFactsEqual(
    left.currentCompletion,
    right.currentCompletion,
  ) && identityEqual(
    left.precedingCompletionIdentity,
    right.precedingCompletionIdentity,
  );
}

function dependencyFactsEqual(
  left: QueryDependencyFacts | null,
  right: QueryDependencyFacts | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.queryKey !== right.queryKey
    || left.generation !== right.generation
    || left.dependencyKeys.length !== right.dependencyKeys.length
  ) {
    return false;
  }
  for (let index = 0; index < left.dependencyKeys.length; index += 1) {
    if (left.dependencyKeys[index] !== right.dependencyKeys[index]) {
      return false;
    }
  }
  return true;
}

function pendingPublicationEqual(
  left: PendingQueryPublication | null,
  right: PendingQueryPublication | null,
): boolean {
  if (left === null || right === null) return left === right;
  return queryPublicationIdentityEquals(left.identity, right.identity)
    && left.queryIdentity === right.queryIdentity
    && left.completedThroughSequence === right.completedThroughSequence
    && left.resultDigest === right.resultDigest
    && left.content === right.content;
}

function deliveredPublicationEqual(
  left: CompletionPublicationLifecycleFacts["latestDelivered"],
  right: CompletionPublicationLifecycleFacts["latestDelivered"],
): boolean {
  if (left === null || right === null) return left === right;
  return queryPublicationIdentityEquals(left.identity, right.identity)
    && left.resultDigest === right.resultDigest;
}

function lifecycleFactsEqual(
  left: CompletionPublicationLifecycleFacts,
  right: CompletionPublicationLifecycleFacts,
): boolean {
  return left.queryKey === right.queryKey
    && pendingPublicationEqual(left.inFlight, right.inFlight)
    && deliveredPublicationEqual(
      left.latestDelivered,
      right.latestDelivered,
    )
    && deliveredPublicationEqual(
      left.precedingAttemptOutcome,
      right.precedingAttemptOutcome,
    );
}

function beginFacts(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): BeginQueryFacts | null {
  const query = findNormalizedQuery(normalized, queryKey);
  return query === undefined
    ? null
    : freezeBeginQueryFacts({
      descriptor: query.descriptor,
      active: query.active,
      provisional: query.provisional,
    });
}

function completeFacts(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): CompleteQueryScalarFacts | null {
  const query = findNormalizedQuery(normalized, queryKey);
  return query === undefined
    ? null
    : freezeCompleteQueryScalarFacts({
      descriptor: query.descriptor,
      active: query.active,
      provisional: query.provisional,
      currentCompletion: query.currentCompletion,
      precedingCompletionIdentity: query.precedingCompletionIdentity,
    });
}

function dependenciesFor(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
  maximumMembers?: number,
): readonly CanonicalDependencyKey[] {
  const dependencyKeys: CanonicalDependencyKey[] = [];
  for (const row of normalized.activeDependencies) {
    if (row.queryKey !== queryKey || row.generation !== generation) continue;
    dependencyKeys.push(row.dependencyKey);
    if (
      maximumMembers !== undefined
      && dependencyKeys.length === maximumMembers
    ) {
      break;
    }
  }
  return Object.freeze(dependencyKeys);
}

function completionDependenciesFor(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
  maximumMembers?: number,
): readonly CanonicalDependencyKey[] {
  const dependencyKeys: CanonicalDependencyKey[] = [];
  for (const row of normalized.completionDependencies) {
    if (row.queryKey !== queryKey || row.generation !== generation) continue;
    dependencyKeys.push(row.dependencyKey);
    if (
      maximumMembers !== undefined
      && dependencyKeys.length === maximumMembers
    ) {
      break;
    }
  }
  return Object.freeze(dependencyKeys);
}

function dependencyFacts(
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
  dependencyKeys: readonly CanonicalDependencyKey[],
): QueryDependencyFacts {
  return Object.freeze({
    queryKey,
    generation,
    dependencyKeys: Object.freeze([...dependencyKeys]),
  });
}

function replayFactsRead(
  normalized: NormalizedQuerySyncState,
  intent: ReadCompleteQueryReplayFactsIntent,
): CompleteQueryReplayFactsRead {
  const query = findNormalizedQuery(normalized, intent.queryKey);
  const completion = query?.currentCompletion;
  if (
    completion === null
    || completion === undefined
    || completion.identity.generation !== intent.completionGeneration
  ) {
    throw transitionDefect("completeQueryEvaluation");
  }
  let retainedPublication: PendingQueryPublication | null = null;
  const retainedIdentity = intent.retainedPublicationIdentity;
  if (retainedIdentity !== null) {
    const pending = normalized.publicationWork.pending.find((publication) => (
      queryPublicationIdentityEquals(
        publication.identity,
        retainedIdentity,
      )
    ));
    const inFlight = normalized.publicationWork.inFlight?.publication;
    retainedPublication = pending
      ?? (inFlight !== undefined && queryPublicationIdentityEquals(
        inFlight.identity,
        retainedIdentity,
      )
        ? inFlight
        : null);
  }
  return freezeCompleteQueryReplayFactsRead({
    queryKey: intent.queryKey,
    completionDependencies: dependencyFacts(
      intent.queryKey,
      intent.completionGeneration,
      completionDependenciesFor(
        normalized,
        intent.queryKey,
        intent.completionGeneration,
        intent.maximumCompletionDependencyMembers,
      ),
    ),
    retainedPublication,
  });
}

function targetPublicationLifecycle(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): CompletionPublicationLifecycleFacts {
  const inFlight = normalized.publicationWork.inFlight;
  const latestDelivered = normalized.publicationWork.latestDelivered;
  const preceding = normalized.publicationWork.precedingAttemptOutcome;
  return Object.freeze({
    queryKey,
    inFlight: inFlight?.publication.identity.queryKey === queryKey
      ? makePendingQueryPublication(inFlight.publication)
      : null,
    latestDelivered: latestDelivered?.identity.queryKey === queryKey
      ? Object.freeze({
        identity: freezeQueryPublicationIdentity(latestDelivered.identity),
        resultDigest: latestDelivered.resultDigest,
      })
      : null,
    precedingAttemptOutcome: preceding?.identity.queryKey === queryKey
      ? Object.freeze({
        identity: freezeQueryPublicationIdentity(preceding.identity),
        resultDigest: preceding.resultDigest,
      })
      : null,
  });
}

function materialFactsRead(
  normalized: NormalizedQuerySyncState,
  intent: ReadCompleteQueryMaterialFactsIntent,
): CompleteQueryMaterialFactsRead {
  const query = findNormalizedQuery(normalized, intent.queryKey);
  if (
    query === undefined
    || intent.pendingPublicationQueryKey !== intent.queryKey
    || intent.publicationLifecycleQueryKey !== intent.queryKey
    || (query.active?.generation ?? null) !== intent.activeGeneration
    || (query.currentCompletion?.identity.generation ?? null)
      !== intent.completionGeneration
  ) {
    throw transitionDefect("completeQueryEvaluation");
  }
  const pendingPublication = normalized.publicationWork.pending.find(
    (publication) => publication.identity.queryKey === intent.queryKey,
  ) ?? null;
  return freezeCompleteQueryMaterialFactsRead({
    queryKey: intent.queryKey,
    activeDependencies: intent.activeGeneration === null
      ? null
      : dependencyFacts(
        intent.queryKey,
        intent.activeGeneration,
        dependenciesFor(
          normalized,
          intent.queryKey,
          intent.activeGeneration,
          intent.maximumActiveDependencyMembers,
        ),
      ),
    completionDependencies: intent.completionGeneration === null
      ? null
      : dependencyFacts(
        intent.queryKey,
        intent.completionGeneration,
        completionDependenciesFor(
          normalized,
          intent.queryKey,
          intent.completionGeneration,
          intent.maximumCompletionDependencyMembers,
        ),
      ),
    pendingPublication,
    lifecycle: targetPublicationLifecycle(normalized, intent.queryKey),
  });
}

function rebuildNormalized(
  normalized: NormalizedQuerySyncState,
  scope: QuerySyncScopeFacts,
  queries: readonly NormalizedQueryRow[],
  operation: NormalizedOperation,
  activeDependencies: readonly NormalizedActiveDependencyRow[] =
    normalized.activeDependencies,
  completionDependencies: readonly NormalizedCompletionDependencyRow[] =
    normalized.completionDependencies,
  publicationWork: QuerySyncPublicationWorkState =
    normalized.publicationWork,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  const dependencySource: NormalizedQuerySyncState = Object.freeze({
    ...normalized,
    activeDependencies,
    completionDependencies,
  });
  return buildQuerySyncState({
    cursor: scope.cursor,
    queries: queries.map((query) => ({
      descriptor: query.descriptor,
      active: query.active === null
        ? null
        : {
          ...query.active,
          dependencyKeys: dependenciesFor(
            dependencySource,
            query.descriptor.queryKey,
            query.active.generation,
          ),
        },
      provisional: query.provisional,
      currentCompletion: query.currentCompletion === null
        ? null
        : {
          ...query.currentCompletion,
          evaluationDependencyKeys: completionDependenciesFor(
            dependencySource,
            query.descriptor.queryKey,
            query.currentCompletion.identity.generation,
          ),
        },
      precedingCompletionIdentity: query.precedingCompletionIdentity,
    })),
    evaluationWork: scope.evaluationWork,
    publicationWork,
  }).pipe(Result.map((state) => {
    if (!querySyncStateMetricsEqual(state.metrics, scope.metrics)) {
      throw transitionDefect(operation);
    }
    return state;
  }));
}

function interpretBeginPlan(
  normalized: NormalizedQuerySyncState,
  plan: BeginQueryEvaluationPlan,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  if (plan._tag === "noWrite") {
    return rebuildNormalized(
      normalized,
      normalized.scope,
      normalized.queries,
      "beginQueryEvaluation",
    );
  }
  const queryExpectation = plan.expected.query;
  const current = findNormalizedQuery(
    normalized,
    queryExpectation.queryKey,
  );
  const expectedFacts = queryExpectation._tag === "absent"
    ? null
    : queryExpectation.facts;
  if (
    !scopeFactsEqual(normalized.scope, plan.expected.scope)
    || plan.change.queryKey !== queryExpectation.queryKey
    || !beginQueryFactsEqual(
      beginFacts(normalized, queryExpectation.queryKey),
      expectedFacts,
    )
    || (current === undefined) !== (queryExpectation._tag === "absent")
  ) {
    throw transitionDefect("beginQueryEvaluation");
  }
  const nextRow: NormalizedQueryRow = Object.freeze({
    descriptor: plan.change.descriptor,
    active: current?.active ?? null,
    provisional: plan.change.provisional,
    currentCompletion: current?.currentCompletion ?? null,
    precedingCompletionIdentity:
      current?.precedingCompletionIdentity ?? null,
  });
  let replaced = false;
  const queries = normalized.queries.map((query) => {
    if (query.descriptor.queryKey !== plan.change.queryKey) return query;
    replaced = true;
    return nextRow;
  });
  if (!replaced) queries.push(nextRow);
  return rebuildNormalized(
    normalized,
    plan.nextScope,
    queries,
    "beginQueryEvaluation",
  );
}

export function executeNormalizedBeginQueryEvaluation(
  normalized: NormalizedQuerySyncState,
  request: BeginQueryEvaluationRequest,
): Result.Result<
  NormalizedTransition<BeginQueryEvaluationReceipt, BeginQueryEvaluationPlan>,
  NormalizedBeginError
> {
  return Result.gen(function* () {
    const plan = yield* planBeginQueryEvaluation({
      scope: normalized.scope,
      query: beginFacts(normalized, request.target.descriptor.queryKey),
      request,
    });
    const state = yield* interpretBeginPlan(normalized, plan);
    return Object.freeze({
      receipt: plan.receipt,
      state,
      disposition: plan._tag,
      plan,
    });
  });
}

function affectedTargetsRead(
  normalized: NormalizedQuerySyncState,
  dependencyKeys: readonly CanonicalDependencyKey[],
): AffectedActiveTargetsRead {
  const requested = new Set(dependencyKeys);
  const targets = new Map<CanonicalQueryKey, QueryGeneration>();
  for (const row of normalized.activeDependencies) {
    if (!requested.has(row.dependencyKey)) continue;
    const prior = targets.get(row.queryKey);
    if (prior !== undefined && prior !== row.generation) {
      throw transitionDefect("applyAdmittedInvalidations");
    }
    targets.set(row.queryKey, row.generation);
    if (targets.size === MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL) {
      return Object.freeze({
        _tag: "limitExceeded",
        observed: MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
      });
    }
  }
  const ordered = [...targets.entries()];
  ordered.sort(([left], [right]) => compareCanonicalBase64Url(left, right));
  return Object.freeze({
    _tag: "complete",
    targets: Object.freeze(ordered.map(([queryKey, activeGeneration]) => (
      Object.freeze({ queryKey, activeGeneration })
    ))),
  });
}

function affectedActiveFacts(
  normalized: NormalizedQuerySyncState,
  targets: readonly AffectedActiveQueryTarget[],
): readonly AffectedActiveQueryFacts[] {
  return Object.freeze(targets.map((target) => {
    const query = findNormalizedQuery(normalized, target.queryKey);
    if (
      query?.active === null
      || query?.active === undefined
      || query.active.generation !== target.activeGeneration
    ) {
      throw transitionDefect("applyAdmittedInvalidations");
    }
    return Object.freeze({
      queryKey: target.queryKey,
      ...freezeActiveScalarFacts(query.active),
    });
  }));
}

function interpretApplyPlan(
  normalized: NormalizedQuerySyncState,
  plan: ApplyAdmittedBatchPlan,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  if (plan._tag === "noWrite") {
    return rebuildNormalized(
      normalized,
      normalized.scope,
      normalized.queries,
      "applyAdmittedInvalidations",
    );
  }
  if (!scopeFactsEqual(normalized.scope, plan.expected.scope)) {
    throw transitionDefect("applyAdmittedInvalidations");
  }
  if (
    plan.expected.affectedTargets.length
      !== plan.expected.affectedActive.length
    || plan.change.active.length !== plan.expected.affectedActive.length
  ) {
    throw transitionDefect("applyAdmittedInvalidations");
  }
  for (let index = 0; index < plan.expected.affectedActive.length; index += 1) {
    const target = plan.expected.affectedTargets[index];
    const expected = plan.expected.affectedActive[index];
    const change = plan.change.active[index];
    const query = expected === undefined
      ? undefined
      : findNormalizedQuery(normalized, expected.queryKey);
    if (
      target === undefined
      || expected === undefined
      || query?.active === null
      || query?.active === undefined
      || target.queryKey !== expected.queryKey
      || target.activeGeneration !== expected.generation
      || !activeFactsEqual(query.active, expected)
      || change === undefined
      || !affectedActiveFactsEqual(change.expected, expected)
      || change.next.queryKey !== expected.queryKey
      || change.next.generation !== expected.generation
      || change.next.evaluationSnapshotSequence
        !== expected.evaluationSnapshotSequence
      || change.next.freshThroughSequence !== expected.freshThroughSequence
      || change.next.resultDigest !== expected.resultDigest
      || change.next.authorityWitness !== expected.authorityWitness
      || change.next.dirtyThroughSequence
        !== plan.nextScope.cursor.appliedThroughSequence
    ) {
      throw transitionDefect("applyAdmittedInvalidations");
    }
  }
  const changes = new Map(plan.change.active.map((change) => (
    [change.expected.queryKey, change] as const
  )));
  const queries = normalized.queries.map((query): NormalizedQueryRow => {
    const change = changes.get(query.descriptor.queryKey);
    if (change === undefined) return query;
    if (
      query.active === null
      || query.active.generation !== change.expected.generation
      || query.active.dirtyThroughSequence
        !== change.expected.dirtyThroughSequence
    ) {
      throw transitionDefect("applyAdmittedInvalidations");
    }
    return Object.freeze({
      ...query,
      active: freezeActiveScalarFacts(change.next),
    });
  });
  return rebuildNormalized(
    normalized,
    plan.nextScope,
    queries,
    "applyAdmittedInvalidations",
  ).pipe(
    Result.map((state) => {
      if (!querySyncStateMetricsEqual(state.metrics, plan.nextScope.metrics)) {
        throw transitionDefect("applyAdmittedInvalidations");
      }
      return state;
    }),
  );
}

export function executeNormalizedApplyAdmittedBatch(
  normalized: NormalizedQuerySyncState,
  batch: AdmittedInvalidationBatch,
): Result.Result<
  NormalizedTransition<ApplyAdmittedBatchReceipt, ApplyAdmittedBatchPlan>,
  NormalizedApplyError
> {
  return Result.gen(function* () {
    const start = yield* startApplyAdmittedBatchAndAdvance({
      scope: normalized.scope,
      batch,
    });
    let plan: ApplyAdmittedBatchPlan;
    if (start._tag === "planned") {
      plan = start.plan;
    } else {
      const next = yield* resumeApplyAdmittedBatchAffectedTargets(
        start.resume,
        affectedTargetsRead(normalized, start.intent.dependencyKeys),
      );
      if (next._tag === "planned") {
        plan = next.plan;
      } else {
        plan = yield* resumeApplyAdmittedBatchActiveFacts(
          next.resume,
          affectedActiveFacts(normalized, next.intent.targets),
        );
      }
    }
    const state = yield* interpretApplyPlan(normalized, plan);
    return Object.freeze({
      receipt: plan.receipt,
      state,
      disposition: plan._tag,
      plan,
    });
  });
}

function orderedActiveDependencyRows(
  rows: readonly NormalizedActiveDependencyRow[],
): readonly NormalizedActiveDependencyRow[] {
  const ordered = [...rows];
  ordered.sort((left, right) => {
    const queryOrder = compareCanonicalBase64Url(
      left.queryKey,
      right.queryKey,
    );
    return queryOrder !== 0
      ? queryOrder
      : compareCanonicalBase64Url(
        left.dependencyKey,
        right.dependencyKey,
      );
  });
  return Object.freeze(ordered);
}

function orderedCompletionDependencyRows(
  rows: readonly NormalizedCompletionDependencyRow[],
): readonly NormalizedCompletionDependencyRow[] {
  const ordered = [...rows];
  ordered.sort((left, right) => {
    const queryOrder = compareCanonicalBase64Url(
      left.queryKey,
      right.queryKey,
    );
    return queryOrder !== 0
      ? queryOrder
      : compareCanonicalBase64Url(
        left.dependencyKey,
        right.dependencyKey,
      );
  });
  return Object.freeze(ordered);
}

function replaceCompleteDependencies(
  normalized: NormalizedQuerySyncState,
  plan: Extract<CompleteQueryEvaluationPlan, { readonly _tag: "write" }>,
): Readonly<{
  readonly active: readonly NormalizedActiveDependencyRow[];
  readonly completion: readonly NormalizedCompletionDependencyRow[];
}> {
  const queryKey = plan.change.queryKey;
  const active = normalized.activeDependencies.filter(
    (row) => row.queryKey !== queryKey,
  );
  for (const dependencyKey of plan.change.active.dependencyKeys) {
    active.push(Object.freeze({
      queryKey,
      generation: plan.change.active.generation,
      dependencyKey,
    }));
  }
  const completion = normalized.completionDependencies.filter(
    (row) => row.queryKey !== queryKey,
  );
  for (
    const dependencyKey of
    plan.change.currentCompletion.evaluationDependencyKeys
  ) {
    completion.push(Object.freeze({
      queryKey,
      generation: plan.change.currentCompletion.identity.generation,
      dependencyKey,
    }));
  }
  return Object.freeze({
    active: orderedActiveDependencyRows(active),
    completion: orderedCompletionDependencyRows(completion),
  });
}

function replaceTargetPendingPublication(
  publicationWork: QuerySyncPublicationWorkState,
  plan: Extract<CompleteQueryEvaluationPlan, { readonly _tag: "write" }>,
): QuerySyncPublicationWorkState {
  const change = plan.change.pendingPublication;
  if (change._tag === "preserveTargetPending") return publicationWork;
  const pending = publicationWork.pending
    .filter((publication) => (
      publication.identity.queryKey !== plan.change.queryKey
    ))
    .map(makePendingQueryPublication);
  pending.push(makePendingQueryPublication(change.publication));
  return Object.freeze({
    pending: Object.freeze(pending),
    inFlight: publicationWork.inFlight,
    latestDelivered: publicationWork.latestDelivered,
    precedingAttemptOutcome: publicationWork.precedingAttemptOutcome,
  });
}

function currentMaterialFacts(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): CompleteQueryMaterialFactsRead {
  const query = findNormalizedQuery(normalized, queryKey);
  if (query === undefined) {
    throw transitionDefect("completeQueryEvaluation");
  }
  return materialFactsRead(normalized, Object.freeze({
    _tag: "readCompleteQueryMaterialFacts",
    queryKey,
    activeGeneration: query.active?.generation ?? null,
    completionGeneration:
      query.currentCompletion?.identity.generation ?? null,
    maximumActiveDependencyMembers: MAX_QUERY_DEPENDENCY_SENTINEL,
    maximumCompletionDependencyMembers: MAX_QUERY_DEPENDENCY_SENTINEL,
    pendingPublicationQueryKey: queryKey,
    publicationLifecycleQueryKey: queryKey,
  }));
}

function interpretCompletePlan(
  normalized: NormalizedQuerySyncState,
  plan: CompleteQueryEvaluationPlan,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  if (plan._tag === "noWrite") {
    return rebuildNormalized(
      normalized,
      normalized.scope,
      normalized.queries,
      "completeQueryEvaluation",
    );
  }
  const queryKey = plan.change.queryKey;
  const actualQuery = completeFacts(normalized, queryKey);
  const actualMaterial = currentMaterialFacts(normalized, queryKey);
  if (
    !scopeFactsEqual(normalized.scope, plan.expected.scope)
    || plan.expected.query.descriptor.queryKey !== queryKey
    || !completeQueryFactsEqual(actualQuery, plan.expected.query)
    || !dependencyFactsEqual(
      actualMaterial.activeDependencies,
      plan.expected.activeDependencies,
    )
    || !dependencyFactsEqual(
      actualMaterial.completionDependencies,
      plan.expected.completionDependencies,
    )
    || !pendingPublicationEqual(
      actualMaterial.pendingPublication,
      plan.expected.pendingPublication,
    )
    || !lifecycleFactsEqual(
      actualMaterial.lifecycle,
      plan.expected.publicationLifecycle,
    )
  ) {
    throw transitionDefect("completeQueryEvaluation");
  }
  const current = findNormalizedQuery(normalized, queryKey);
  if (current === undefined) {
    throw transitionDefect("completeQueryEvaluation");
  }
  const replacement: NormalizedQueryRow = Object.freeze({
    descriptor: freezeDescriptor(current.descriptor),
    active: freezeActiveScalarFacts(plan.change.active),
    provisional: null,
    currentCompletion: freezeCompletionScalarFacts(
      plan.change.currentCompletion,
    ),
    precedingCompletionIdentity:
      plan.change.precedingCompletionIdentity === null
        ? null
        : freezeQueryPublicationIdentity(
          plan.change.precedingCompletionIdentity,
        ),
  });
  let replaced = false;
  const queries = normalized.queries.map((query) => {
    if (query.descriptor.queryKey !== queryKey) return query;
    replaced = true;
    return replacement;
  });
  if (!replaced) {
    throw transitionDefect("completeQueryEvaluation");
  }
  const dependencies = replaceCompleteDependencies(normalized, plan);
  const publicationWork = replaceTargetPendingPublication(
    normalized.publicationWork,
    plan,
  );
  return rebuildNormalized(
    normalized,
    plan.nextScope,
    queries,
    "completeQueryEvaluation",
    dependencies.active,
    dependencies.completion,
    publicationWork,
  );
}

export function executeNormalizedCompleteQueryEvaluation(
  normalized: NormalizedQuerySyncState,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
  publication: QueryPublicationArtifact,
): Result.Result<
  NormalizedTransition<
    CompleteQueryEvaluationReceipt,
    CompleteQueryEvaluationPlan
  >,
  NormalizedCompleteError
> {
  return Result.gen(function* () {
    const start = yield* startCompleteQueryEvaluation({
      scope: normalized.scope,
      query: completeFacts(normalized, attempt.descriptor.queryKey),
      attempt,
      evaluation,
      refresh,
      publication,
    });
    let plan: CompleteQueryEvaluationPlan;
    if (start._tag === "planned") {
      plan = start.plan;
    } else if (start.stage === "replay") {
      plan = yield* resumeCompleteQueryEvaluationReplay(
        start.resume,
        replayFactsRead(normalized, start.intent),
      );
    } else {
      plan = yield* resumeCompleteQueryEvaluationMaterial(
        start.resume,
        materialFactsRead(normalized, start.intent),
      );
    }
    const state = yield* interpretCompletePlan(normalized, plan);
    return Object.freeze({
      receipt: plan.receipt,
      state,
      disposition: plan._tag,
      plan,
    });
  });
}

function normalizedEvaluationWorkScanOrder(
  normalized: NormalizedQuerySyncState,
  anchor: CanonicalQueryKey | null,
): readonly NormalizedQueryRow[] {
  if (anchor === null || normalized.queries.length === 0) {
    return normalized.queries;
  }
  const anchorIndex = normalized.queries.findIndex((query) => (
    query.descriptor.queryKey === anchor
  ));
  if (anchorIndex < 0) return normalized.queries;
  return Object.freeze([
    ...normalized.queries.slice(anchorIndex + 1),
    ...normalized.queries.slice(0, anchorIndex + 1),
  ]);
}

function normalizedEvaluationWorkScanFacts(
  query: NormalizedQueryRow,
): EvaluationWorkScanFacts {
  return Object.freeze({
    queryKey: query.descriptor.queryKey,
    active: query.active === null
      ? null
      : Object.freeze({
        generation: query.active.generation,
        dirtyThroughSequence: query.active.dirtyThroughSequence,
      }),
    provisional: query.provisional === null
      ? null
      : Object.freeze({
        generation: query.provisional.generation,
        evaluationDisposition: query.provisional.evaluationDisposition,
      }),
  });
}

function normalizedEvaluationWorkScanRead(
  normalized: NormalizedQuerySyncState,
  intent: ReadEvaluationWorkScanFactsIntent,
): EvaluationWorkScanFactsRead {
  const order = normalizedEvaluationWorkScanOrder(
    normalized,
    intent.scanStartFairnessAnchor,
  );
  if (order.length >= intent.maximumCombinedQueryFacts) {
    return Object.freeze({
      _tag: "limitExceeded",
      observed: intent.maximumCombinedQueryFacts,
    });
  }
  const lastIndex = intent.lastInspectedQueryKey === null
    ? -1
    : order.findIndex((query) => (
      query.descriptor.queryKey === intent.lastInspectedQueryKey
    ));
  const prefix = lastIndex < 0
    ? []
    : order.slice(0, lastIndex + 1)
      .map(normalizedEvaluationWorkScanFacts);
  const pageStart = lastIndex + 1;
  const pageEnd = Math.min(
    order.length,
    pageStart + intent.maximumPageQueryInspections,
  );
  const page = order.slice(pageStart, pageEnd)
    .map(normalizedEvaluationWorkScanFacts);
  return Object.freeze({
    _tag: "complete",
    fairnessAnchorPresent:
      intent.scanStartFairnessAnchor !== null
      && normalized.queries.some((query) => (
        query.descriptor.queryKey === intent.scanStartFairnessAnchor
      )),
    revalidationPrefix: Object.freeze(prefix),
    page: Object.freeze(page),
    hasMore: pageEnd < order.length,
  });
}

function normalizedEvaluationSelectedQueryFacts(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
): EvaluationSelectedQueryFacts | null {
  const query = findNormalizedQuery(normalized, queryKey);
  return query === undefined
    ? null
    : Object.freeze({
      descriptor: query.descriptor,
      active: query.active,
      provisional: query.provisional,
    });
}

function interpretClaimEvaluationWorkPlan(
  normalized: NormalizedQuerySyncState,
  plan: ClaimEvaluationWorkPlan,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  if (plan._tag === "noWrite") {
    return rebuildNormalized(
      normalized,
      normalized.scope,
      normalized.queries,
      "claimEvaluationWork",
    );
  }
  const queryKey = plan.change.queryKey;
  const current = findNormalizedQuery(normalized, queryKey);
  if (
    current === undefined
    || !scopeFactsEqual(normalized.scope, plan.expected.scope)
    || !beginQueryFactsEqual(
      normalizedEvaluationSelectedQueryFacts(normalized, queryKey),
      plan.expected.query,
    )
  ) {
    throw transitionDefect("claimEvaluationWork");
  }
  const change = plan.change;
  const queries = change._tag === "claimReadyEvaluationWork"
    ? normalized.queries
    : normalized.queries.map((query): NormalizedQueryRow => (
      query.descriptor.queryKey === queryKey
        ? Object.freeze({
          ...query,
          provisional: freezeProvisionalFacts(change.provisional),
        })
        : query
    ));
  return rebuildNormalized(
    normalized,
    plan.nextScope,
    queries,
    "claimEvaluationWork",
  );
}

export function executeNormalizedClaimEvaluationWork(
  normalized: NormalizedQuerySyncState,
  request: EvaluationWorkScanRequest,
): Result.Result<
  NormalizedTransition<ClaimEvaluationWorkReceipt, ClaimEvaluationWorkPlan>,
  NormalizedClaimEvaluationWorkError
> {
  return Result.gen(function* () {
    const start = yield* startClaimEvaluationWork({
      scope: normalized.scope,
      request,
    });
    let plan: ClaimEvaluationWorkPlan;
    if (start._tag === "planned") {
      plan = start.plan;
    } else {
      const scan = yield* resumeClaimEvaluationWorkScan(
        start.resume,
        normalizedEvaluationWorkScanRead(normalized, start.intent),
      );
      plan = scan._tag === "planned"
        ? scan.plan
        : yield* resumeClaimEvaluationWorkSelectedQuery(
          scan.resume,
          normalizedEvaluationSelectedQueryFacts(
            normalized,
            scan.intent.queryKey,
          ),
        );
    }
    const state = yield* interpretClaimEvaluationWorkPlan(normalized, plan);
    return Object.freeze({
      receipt: plan.receipt,
      state,
      disposition: plan._tag,
      plan,
    });
  });
}

function interpretRecordEvaluationAttemptOutcomePlan(
  normalized: NormalizedQuerySyncState,
  plan: RecordEvaluationAttemptOutcomePlan,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  if (plan._tag === "noWrite") {
    return rebuildNormalized(
      normalized,
      normalized.scope,
      normalized.queries,
      "recordEvaluationAttemptOutcome",
    );
  }
  const queryKey = plan.change.queryKey;
  const current = findNormalizedQuery(normalized, queryKey);
  if (
    current === undefined
    || !scopeFactsEqual(normalized.scope, plan.expected.scope)
    || !evaluationAttemptOutcomeFactsEqual(
      evaluationAttemptOutcomeFacts(normalized, queryKey),
      plan.expected.query,
    )
  ) {
    throw transitionDefect("recordEvaluationAttemptOutcome");
  }
  const replacement: NormalizedQueryRow = Object.freeze({
    ...current,
    provisional: freezeProvisionalFacts(plan.change.provisional),
  });
  const queries = normalized.queries.map((query) => (
    query.descriptor.queryKey === queryKey ? replacement : query
  ));
  return rebuildNormalized(
    normalized,
    plan.nextScope,
    queries,
    "recordEvaluationAttemptOutcome",
  );
}

export function executeNormalizedRecordEvaluationAttemptOutcome(
  normalized: NormalizedQuerySyncState,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
): Result.Result<
  NormalizedTransition<
    RecordEvaluationAttemptOutcomeReceipt,
    RecordEvaluationAttemptOutcomePlan
  >,
  NormalizedRecordEvaluationAttemptOutcomeError
> {
  return Result.gen(function* () {
    const authenticated = yield*
      authenticateRecordEvaluationAttemptOutcomeAttempt(attempt);
    const plan = yield* planRecordEvaluationAttemptOutcome({
      scope: normalized.scope,
      query: evaluationAttemptOutcomeFacts(
        normalized,
        authenticated.queryKey,
      ),
      attempt: authenticated.attempt,
      outcome,
    });
    const state = yield* interpretRecordEvaluationAttemptOutcomePlan(
      normalized,
      plan,
    );
    return Object.freeze({
      receipt: plan.receipt,
      state,
      disposition: plan._tag,
      plan,
    });
  });
}

export function normalizedQueryCount(
  normalized: NormalizedQuerySyncState,
): number {
  return normalized.queries.length;
}

export const NORMALIZED_APPLY_AFFECTED_LIMIT =
  MAX_INVALIDATION_AFFECTED_QUERIES;
