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
  ProvisionalQueryState,
  QueryCompletionFingerprint,
  QueryDescriptor,
  QuerySyncPublicationWorkState,
  QuerySyncState,
} from "../../kernel/Model.js";
import type { QueryPublicationIdentity } from "../../kernel/Publication.js";
import {
  freezePublicationDisposition,
  freezeQueryPublicationIdentity,
} from "../../kernel/Publication.js";
import {
  planBeginQueryEvaluation,
} from "../../transition-plan/BeginQueryEvaluation.js";
import type {
  BeginQueryEvaluationPlan,
  PlanBeginQueryEvaluationError,
} from "../../transition-plan/BeginQueryEvaluation.js";
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
  freezeProvisionalFacts,
  projectActiveScalarFacts,
} from "../../transition-plan/Facts.js";
import type {
  ActiveQueryScalarFacts,
  AffectedActiveQueryFacts,
  AffectedActiveQueryTarget,
  BeginQueryFacts,
} from "../../transition-plan/Facts.js";
import {
  MAX_INVALIDATION_AFFECTED_QUERIES,
  MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
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
} from "../../transition-plan/Receipts.js";

type NormalizedCompletionScalarFacts = Omit<
  QueryCompletionFingerprint,
  "evaluationDependencyKeys"
>;

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

function transitionDefect(
  operation: "beginQueryEvaluation" | "applyAdmittedInvalidations",
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
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(completion.identity),
    queryIdentity: completion.queryIdentity,
    expectedActiveGeneration: completion.expectedActiveGeneration,
    registrationCursor: Object.freeze({
      namespaceId: completion.registrationCursor.namespaceId,
      syncModelId: completion.registrationCursor.syncModelId,
      sourceEpoch: completion.registrationCursor.sourceEpoch,
      appliedThroughSequence:
        completion.registrationCursor.appliedThroughSequence,
    }),
    requestedDirtyThroughSequence:
      completion.requestedDirtyThroughSequence,
    evaluationSnapshotSequence: completion.evaluationSnapshotSequence,
    evaluationAuthorityWitness: completion.evaluationAuthorityWitness,
    refreshedThroughSequence: completion.refreshedThroughSequence,
    relevantThroughSequence: completion.relevantThroughSequence,
    refreshAuthorityWitness: completion.refreshAuthorityWitness,
    resultDigest: completion.resultDigest,
    publicationDisposition: freezePublicationDisposition(
      completion.publicationDisposition,
    ),
  });
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

function dependenciesFor(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
): readonly CanonicalDependencyKey[] {
  return Object.freeze(normalized.activeDependencies
    .filter((row) => (
      row.queryKey === queryKey && row.generation === generation
    ))
    .map((row) => row.dependencyKey));
}

function completionDependenciesFor(
  normalized: NormalizedQuerySyncState,
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
): readonly CanonicalDependencyKey[] {
  return Object.freeze(normalized.completionDependencies
    .filter((row) => (
      row.queryKey === queryKey && row.generation === generation
    ))
    .map((row) => row.dependencyKey));
}

function rebuildNormalized(
  normalized: NormalizedQuerySyncState,
  scope: QuerySyncScopeFacts,
  queries: readonly NormalizedQueryRow[],
  operation: "beginQueryEvaluation" | "applyAdmittedInvalidations",
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  return buildQuerySyncState({
    cursor: scope.cursor,
    queries: queries.map((query) => ({
      descriptor: query.descriptor,
      active: query.active === null
        ? null
        : {
          ...query.active,
          dependencyKeys: dependenciesFor(
            normalized,
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
            normalized,
            query.descriptor.queryKey,
            query.currentCompletion.identity.generation,
          ),
        },
      precedingCompletionIdentity: query.precedingCompletionIdentity,
    })),
    evaluationWork: scope.evaluationWork,
    publicationWork: normalized.publicationWork,
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

export function normalizedQueryCount(
  normalized: NormalizedQuerySyncState,
): number {
  return normalized.queries.length;
}

export const NORMALIZED_APPLY_AFFECTED_LIMIT =
  MAX_INVALIDATION_AFFECTED_QUERIES;
