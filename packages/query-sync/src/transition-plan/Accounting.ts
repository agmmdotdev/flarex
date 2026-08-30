import { Result } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  QUERY_AUTHORITY_WITNESS_BYTES,
  QUERY_KEY_BYTES,
  QUERY_RESULT_DIGEST_BYTES,
  wellFormedUtf8ByteLength,
} from "../kernel/CanonicalValue.js";
import type { SyncSequence } from "../kernel/CanonicalValue.js";
import { QuerySyncStateLimitError } from "../kernel/Errors.js";
import type {
  ActiveQueryState,
  NamespaceCursor,
  PrecedingPublicationAttemptOutcome,
  ProvisionalQueryState,
  QueryCompletionFingerprint,
  QueryDescriptor,
  QuerySyncEvaluationWorkState,
  QuerySyncPublicationWorkState,
  QuerySyncStateMetrics,
} from "../kernel/Model.js";
import {
  canonicalPublicationContentDecodedLength,
  MAX_PENDING_PUBLICATIONS,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
} from "../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";

export const MAX_REFERENCE_QUERIES = 4_096;
export const MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS = 262_144;
export const MAX_RETAINED_QUERY_IDENTITY_BYTES = 32 * 1_024 * 1_024;
export const MAX_COUNTED_CANONICAL_BYTES = 64 * 1_024 * 1_024;

const FIXED_WIDTH_INTEGER_BYTES = 8;
const SLOT_PRESENCE_BYTES = 1;
const PUBLICATION_ATTEMPT_OUTCOME_BYTES = 1;
const PUBLICATION_DELIVERED_TOMBSTONE_BYTES = QUERY_KEY_BYTES
  + FIXED_WIDTH_INTEGER_BYTES
  + QUERY_RESULT_DIGEST_BYTES;
const PUBLICATION_IN_FLIGHT_METADATA_BYTES =
  (3 * FIXED_WIDTH_INTEGER_BYTES) + 3;
const PUBLICATION_PRECEDING_OUTCOME_BYTES = QUERY_KEY_BYTES
  + (2 * FIXED_WIDTH_INTEGER_BYTES)
  + QUERY_RESULT_DIGEST_BYTES
  + PUBLICATION_ATTEMPT_OUTCOME_BYTES
  + 10;
export const PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES =
  PUBLICATION_IN_FLIGHT_METADATA_BYTES
  + PUBLICATION_PRECEDING_OUTCOME_BYTES
  + PUBLICATION_DELIVERED_TOMBSTONE_BYTES;

export interface QuerySyncMetricContribution {
  readonly queryCount: number;
  readonly retainedIdentityBytes: number;
  readonly dependencyMemberships: number;
  readonly pendingPublicationCount: number;
  readonly inFlightPublicationCount: number;
  readonly retainedPublicationContentBytes: number;
  readonly settlementEnvelopeBytes: number;
  readonly countedCanonicalBytes: number;
}

export interface QuerySyncAccountingInput {
  readonly cursor: NamespaceCursor;
  readonly queries: readonly Readonly<{
    readonly descriptor: QueryDescriptor;
    readonly active: ActiveQueryState | null;
    readonly provisional: ProvisionalQueryState | null;
    readonly currentCompletion: QueryCompletionFingerprint | null;
    readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
  }>[];
  readonly evaluationWork: QuerySyncEvaluationWorkState;
  readonly publicationWork: QuerySyncPublicationWorkState;
}

export type PublicationLifecycleAccountingFacts = Pick<
  QuerySyncPublicationWorkState,
  "inFlight" | "latestDelivered" | "precedingAttemptOutcome"
>;

export function emptyMetricContribution(): QuerySyncMetricContribution {
  return Object.freeze({
    queryCount: 0,
    retainedIdentityBytes: 0,
    dependencyMemberships: 0,
    pendingPublicationCount: 0,
    inFlightPublicationCount: 0,
    retainedPublicationContentBytes: 0,
    settlementEnvelopeBytes: 0,
    countedCanonicalBytes: 0,
  });
}

export function addMetricContribution(
  target: QuerySyncMetricContribution,
  contribution: QuerySyncMetricContribution,
): QuerySyncMetricContribution {
  return {
    queryCount: target.queryCount + contribution.queryCount,
    retainedIdentityBytes:
      target.retainedIdentityBytes + contribution.retainedIdentityBytes,
    dependencyMemberships:
      target.dependencyMemberships + contribution.dependencyMemberships,
    pendingPublicationCount:
      target.pendingPublicationCount + contribution.pendingPublicationCount,
    inFlightPublicationCount:
      target.inFlightPublicationCount + contribution.inFlightPublicationCount,
    retainedPublicationContentBytes:
      target.retainedPublicationContentBytes
      + contribution.retainedPublicationContentBytes,
    settlementEnvelopeBytes:
      target.settlementEnvelopeBytes + contribution.settlementEnvelopeBytes,
    countedCanonicalBytes:
      target.countedCanonicalBytes + contribution.countedCanonicalBytes,
  };
}

export function applyMetricReplacement(
  metrics: QuerySyncStateMetrics,
  before: QuerySyncMetricContribution,
  after: QuerySyncMetricContribution,
): QuerySyncStateMetrics {
  return Object.freeze({
    queryCount: metrics.queryCount - before.queryCount + after.queryCount,
    retainedIdentityBytes: metrics.retainedIdentityBytes
      - before.retainedIdentityBytes + after.retainedIdentityBytes,
    dependencyMemberships: metrics.dependencyMemberships
      - before.dependencyMemberships + after.dependencyMemberships,
    pendingPublicationCount: metrics.pendingPublicationCount
      - before.pendingPublicationCount + after.pendingPublicationCount,
    inFlightPublicationCount: metrics.inFlightPublicationCount
      - before.inFlightPublicationCount + after.inFlightPublicationCount,
    retainedPublicationContentBytes: metrics.retainedPublicationContentBytes
      - before.retainedPublicationContentBytes
      + after.retainedPublicationContentBytes,
    settlementEnvelopeBytes: metrics.settlementEnvelopeBytes
      - before.settlementEnvelopeBytes + after.settlementEnvelopeBytes,
    countedCanonicalBytes: metrics.countedCanonicalBytes
      - before.countedCanonicalBytes + after.countedCanonicalBytes,
  });
}

export function scopeMetricContribution(
  cursor: NamespaceCursor,
  evaluationWork: QuerySyncEvaluationWorkState,
): QuerySyncMetricContribution {
  return {
    ...emptyMetricContribution(),
    countedCanonicalBytes:
      wellFormedUtf8ByteLength(cursor.namespaceId)
      + wellFormedUtf8ByteLength(cursor.syncModelId)
      + wellFormedUtf8ByteLength(cursor.sourceEpoch)
      + FIXED_WIDTH_INTEGER_BYTES
      + FIXED_WIDTH_INTEGER_BYTES
      + SLOT_PRESENCE_BYTES
      + (evaluationWork.fairnessAnchor === null ? 0 : QUERY_KEY_BYTES)
      + (3 * SLOT_PRESENCE_BYTES),
  };
}

export function queryDescriptorMetricContribution(
  descriptor: QueryDescriptor,
): QuerySyncMetricContribution {
  const identityBytes = canonicalBase64UrlDecodedLength(
    descriptor.queryIdentity,
  );
  return {
    ...emptyMetricContribution(),
    queryCount: 1,
    retainedIdentityBytes: identityBytes,
    countedCanonicalBytes:
      QUERY_KEY_BYTES + identityBytes + (4 * SLOT_PRESENCE_BYTES),
  };
}

export function provisionalMetricContribution(
  provisional: ProvisionalQueryState | null,
): QuerySyncMetricContribution {
  if (provisional === null) return emptyMetricContribution();
  return {
    ...emptyMetricContribution(),
    countedCanonicalBytes:
      (2 * FIXED_WIDTH_INTEGER_BYTES)
      + (2 * SLOT_PRESENCE_BYTES)
      + 1
      + (provisional.evaluationDisposition._tag === "blocked" ? 2 : 0)
      + (provisional.expectedActiveGeneration === null
        ? 0
        : FIXED_WIDTH_INTEGER_BYTES)
      + (provisional.requestedDirtyThroughSequence === null
        ? 0
        : FIXED_WIDTH_INTEGER_BYTES),
  };
}

export function activeMetricContribution(
  active: ActiveQueryState | null,
): QuerySyncMetricContribution {
  if (active === null) return emptyMetricContribution();
  let countedCanonicalBytes = (3 * FIXED_WIDTH_INTEGER_BYTES)
    + QUERY_RESULT_DIGEST_BYTES
    + QUERY_AUTHORITY_WITNESS_BYTES
    + SLOT_PRESENCE_BYTES
    + (active.dirtyThroughSequence === null ? 0 : FIXED_WIDTH_INTEGER_BYTES);
  for (const dependencyKey of active.dependencyKeys) {
    countedCanonicalBytes += canonicalBase64UrlDecodedLength(dependencyKey);
  }
  return {
    ...emptyMetricContribution(),
    dependencyMemberships: active.dependencyKeys.length,
    countedCanonicalBytes,
  };
}

export function activeScalarMetricContribution(active: {
  readonly dirtyThroughSequence: SyncSequence | null;
} | null): QuerySyncMetricContribution {
  if (active === null) return emptyMetricContribution();
  return {
    ...emptyMetricContribution(),
    countedCanonicalBytes: (3 * FIXED_WIDTH_INTEGER_BYTES)
      + QUERY_RESULT_DIGEST_BYTES
      + QUERY_AUTHORITY_WITNESS_BYTES
      + SLOT_PRESENCE_BYTES
      + (active.dirtyThroughSequence === null ? 0 : FIXED_WIDTH_INTEGER_BYTES),
  };
}

export function completionMetricContribution(
  descriptor: QueryDescriptor,
  completion: QueryCompletionFingerprint | null,
): QuerySyncMetricContribution {
  if (completion === null) return emptyMetricContribution();
  let countedCanonicalBytes = QUERY_KEY_BYTES
    + canonicalBase64UrlDecodedLength(descriptor.queryIdentity)
    + (4 * FIXED_WIDTH_INTEGER_BYTES)
    + (2 * QUERY_AUTHORITY_WITNESS_BYTES)
    + QUERY_RESULT_DIGEST_BYTES
    + (4 * SLOT_PRESENCE_BYTES)
    + (completion.expectedActiveGeneration === null
      ? 0
      : FIXED_WIDTH_INTEGER_BYTES)
    + (completion.relevantThroughSequence === null
      ? 0
      : FIXED_WIDTH_INTEGER_BYTES)
    + (completion.requestedDirtyThroughSequence === null
      ? 0
      : FIXED_WIDTH_INTEGER_BYTES);
  for (const dependencyKey of completion.evaluationDependencyKeys) {
    countedCanonicalBytes += canonicalBase64UrlDecodedLength(dependencyKey);
  }
  return { ...emptyMetricContribution(), countedCanonicalBytes };
}

export function precedingCompletionMetricContribution(
  preceding: QueryPublicationIdentity | null,
): QuerySyncMetricContribution {
  return {
    ...emptyMetricContribution(),
    countedCanonicalBytes: preceding === null
      ? 0
      : QUERY_KEY_BYTES + FIXED_WIDTH_INTEGER_BYTES,
  };
}

export function queryMetricContribution(
  query: QuerySyncAccountingInput["queries"][number],
): QuerySyncMetricContribution {
  let contribution = queryDescriptorMetricContribution(query.descriptor);
  contribution = addMetricContribution(
    contribution,
    provisionalMetricContribution(query.provisional),
  );
  contribution = addMetricContribution(
    contribution,
    activeMetricContribution(query.active),
  );
  contribution = addMetricContribution(
    contribution,
    completionMetricContribution(query.descriptor, query.currentCompletion),
  );
  return addMetricContribution(
    contribution,
    precedingCompletionMetricContribution(
      query.precedingCompletionIdentity,
    ),
  );
}

export function retainedPublicationMetricContribution(
  publication: PendingQueryPublication,
  kind: "pending" | "inFlight",
): QuerySyncMetricContribution {
  const contentBytes = canonicalPublicationContentDecodedLength(
    publication.content,
  );
  return {
    ...emptyMetricContribution(),
    pendingPublicationCount: kind === "pending" ? 1 : 0,
    inFlightPublicationCount: kind === "inFlight" ? 1 : 0,
    retainedPublicationContentBytes: contentBytes,
    countedCanonicalBytes: QUERY_KEY_BYTES
      + canonicalBase64UrlDecodedLength(publication.queryIdentity)
      + (2 * FIXED_WIDTH_INTEGER_BYTES)
      + QUERY_RESULT_DIGEST_BYTES
      + contentBytes,
  };
}

function precedingOutcomeBytes(
  outcome: PrecedingPublicationAttemptOutcome,
): number {
  return QUERY_KEY_BYTES
    + (2 * FIXED_WIDTH_INTEGER_BYTES)
    + QUERY_RESULT_DIGEST_BYTES
    + PUBLICATION_ATTEMPT_OUTCOME_BYTES
    + (outcome.receipt._tag === "recorded" ? 10 : 3);
}

export function publicationLifecycleMetricContribution(
  publicationWork: PublicationLifecycleAccountingFacts,
): QuerySyncMetricContribution {
  let lifecycleBytes = 0;
  if (publicationWork.inFlight !== null) {
    lifecycleBytes += (3 * FIXED_WIDTH_INTEGER_BYTES)
      + (publicationWork.inFlight.disposition._tag === "blocked" ? 3 : 1);
  }
  if (publicationWork.latestDelivered !== null) {
    lifecycleBytes += PUBLICATION_DELIVERED_TOMBSTONE_BYTES;
  }
  if (publicationWork.precedingAttemptOutcome !== null) {
    lifecycleBytes += precedingOutcomeBytes(
      publicationWork.precedingAttemptOutcome,
    );
  }
  const settlementEnvelopeBytes = publicationWork.inFlight === null
    ? 0
    : Math.max(
      0,
      PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES - lifecycleBytes,
    );
  return {
    ...emptyMetricContribution(),
    settlementEnvelopeBytes,
    countedCanonicalBytes: lifecycleBytes + settlementEnvelopeBytes,
  };
}

export function calculateQuerySyncStateMetrics(
  input: QuerySyncAccountingInput,
): QuerySyncStateMetrics {
  let metrics = scopeMetricContribution(input.cursor, input.evaluationWork);
  for (const query of input.queries) {
    metrics = addMetricContribution(metrics, queryMetricContribution(query));
  }
  for (const publication of input.publicationWork.pending) {
    metrics = addMetricContribution(
      metrics,
      retainedPublicationMetricContribution(publication, "pending"),
    );
  }
  if (input.publicationWork.inFlight !== null) {
    metrics = addMetricContribution(
      metrics,
      retainedPublicationMetricContribution(
        input.publicationWork.inFlight.publication,
        "inFlight",
      ),
    );
  }
  metrics = addMetricContribution(
    metrics,
    publicationLifecycleMetricContribution(input.publicationWork),
  );
  return Object.freeze(metrics);
}

function stateLimitError(
  dimension: QuerySyncStateLimitError["dimension"],
  maximum: number,
  observed: number,
): QuerySyncStateLimitError {
  return new QuerySyncStateLimitError({
    operation: "buildQuerySyncState",
    dimension,
    maximum,
    observed,
  });
}

export function validateQuerySyncStateMetrics(
  metrics: QuerySyncStateMetrics,
): Result.Result<void, QuerySyncStateLimitError> {
  const failure = firstQuerySyncStateMetricLimit(metrics);
  return failure === null
    ? Result.succeed(undefined)
    : Result.fail(failure);
}

export function firstQuerySyncStateMetricLimit(
  metrics: QuerySyncStateMetrics,
): QuerySyncStateLimitError | null {
  const limits: readonly Readonly<{
    readonly dimension: QuerySyncStateLimitError["dimension"];
    readonly maximum: number;
    readonly observed: number;
  }>[] = [
    { dimension: "queryCount", maximum: MAX_REFERENCE_QUERIES,
      observed: metrics.queryCount },
    { dimension: "retainedIdentityBytes",
      maximum: MAX_RETAINED_QUERY_IDENTITY_BYTES,
      observed: metrics.retainedIdentityBytes },
    { dimension: "dependencyMemberships",
      maximum: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
      observed: metrics.dependencyMemberships },
    { dimension: "pendingPublicationCount", maximum: MAX_PENDING_PUBLICATIONS,
      observed: metrics.pendingPublicationCount },
    { dimension: "retainedPublicationContentBytes",
      maximum: MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
      observed: metrics.retainedPublicationContentBytes },
    { dimension: "countedCanonicalBytes",
      maximum: MAX_COUNTED_CANONICAL_BYTES,
      observed: metrics.countedCanonicalBytes },
  ];
  for (const limit of limits) {
    if (limit.observed > limit.maximum) {
      return stateLimitError(
        limit.dimension,
        limit.maximum,
        limit.observed,
      );
    }
  }
  return null;
}
