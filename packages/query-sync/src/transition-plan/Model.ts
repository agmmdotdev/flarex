import type {
  CanonicalQueryKey,
  QuerySyncWorkRevision,
} from "../kernel/CanonicalValue.js";
import type {
  NamespaceCursor,
  QuerySyncStateMetrics,
} from "../kernel/Model.js";

export interface QuerySyncScopeFacts {
  readonly cursor: NamespaceCursor;
  readonly evaluationWork: Readonly<{
    readonly revision: QuerySyncWorkRevision;
    readonly fairnessAnchor: CanonicalQueryKey | null;
  }>;
  readonly metrics: QuerySyncStateMetrics;
}

export type TransitionDisposition = "noWrite" | "write";

export type TransitionPlan<Receipt, Expectation, Change> =
  | Readonly<{
    readonly _tag: "noWrite";
    readonly receipt: Receipt;
  }>
  | Readonly<{
    readonly _tag: "write";
    readonly receipt: Receipt;
    readonly expected: Expectation;
    readonly nextScope: QuerySyncScopeFacts;
    readonly change: Change;
  }>;

export type TransitionStep<Plan, Intent, Resume> =
  | Readonly<{
    readonly _tag: "planned";
    readonly plan: Plan;
  }>
  | Readonly<{
    readonly _tag: "read";
    readonly intent: Intent;
    readonly resume: Resume;
  }>;

export function freezeMetrics(
  metrics: QuerySyncStateMetrics,
): QuerySyncStateMetrics {
  return Object.freeze({
    queryCount: metrics.queryCount,
    retainedIdentityBytes: metrics.retainedIdentityBytes,
    dependencyMemberships: metrics.dependencyMemberships,
    pendingPublicationCount: metrics.pendingPublicationCount,
    inFlightPublicationCount: metrics.inFlightPublicationCount,
    retainedPublicationContentBytes:
      metrics.retainedPublicationContentBytes,
    settlementEnvelopeBytes: metrics.settlementEnvelopeBytes,
    countedCanonicalBytes: metrics.countedCanonicalBytes,
  });
}

export function freezeScopeFacts(
  scope: QuerySyncScopeFacts,
): QuerySyncScopeFacts {
  return Object.freeze({
    cursor: Object.freeze({
      namespaceId: scope.cursor.namespaceId,
      syncModelId: scope.cursor.syncModelId,
      sourceEpoch: scope.cursor.sourceEpoch,
      appliedThroughSequence: scope.cursor.appliedThroughSequence,
    }),
    evaluationWork: Object.freeze({
      revision: scope.evaluationWork.revision,
      fairnessAnchor: scope.evaluationWork.fairnessAnchor,
    }),
    metrics: freezeMetrics(scope.metrics),
  });
}

export function querySyncStateMetricsEqual(
  left: QuerySyncStateMetrics,
  right: QuerySyncStateMetrics,
): boolean {
  return left.queryCount === right.queryCount
    && left.retainedIdentityBytes === right.retainedIdentityBytes
    && left.dependencyMemberships === right.dependencyMemberships
    && left.pendingPublicationCount === right.pendingPublicationCount
    && left.inFlightPublicationCount === right.inFlightPublicationCount
    && left.retainedPublicationContentBytes
      === right.retainedPublicationContentBytes
    && left.settlementEnvelopeBytes === right.settlementEnvelopeBytes
    && left.countedCanonicalBytes === right.countedCanonicalBytes;
}

export function plannedStep<Plan>(plan: Plan): Readonly<{
  readonly _tag: "planned";
  readonly plan: Plan;
}> {
  return Object.freeze({ _tag: "planned", plan });
}

export function readStep<Intent, Resume>(
  intent: Intent,
  resume: Resume,
): Readonly<{
  readonly _tag: "read";
  readonly intent: Intent;
  readonly resume: Resume;
}> {
  return Object.freeze({ _tag: "read", intent, resume });
}
