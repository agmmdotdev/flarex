import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { Effect, Result } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  querySnapshotAsSyncSequence,
  successorSyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  InvalidRefreshEvidenceError,
  QuerySyncEpochMismatchError,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncWorkLimitError,
} from "../kernel/Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncWorkLimitDimension,
} from "../kernel/Errors.js";
import {
  makeGenerationRefreshEvidence,
  MAX_REFRESH_BATCHES,
  MAX_REFRESH_CANONICAL_BYTES,
  MAX_REFRESH_KEY_EXAMINATIONS,
} from "../kernel/Model.js";
import type {
  AdmittedInvalidationBatch,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
} from "../kernel/Model.js";
import {
  ChangeSourceCorruptionError,
  ChangeSourceCursorAheadError,
  ChangeSourceIncompatibleError,
  ChangeSourceLimitError,
  ChangeSourceSequenceExhaustedError,
  CommittedChangeInvalidError,
} from "./Errors.js";
import type {
  AdmittedChangeSourceError,
  ChangeBudgetShortfallDimension,
  ChangeProjectionError,
  ChangeProjectionLimitDimension,
  ChangeProjectionOperation,
  ChangeSourceLimitDimension,
  ChangeSourceReadError,
  RefreshEvidenceAdmissionError,
} from "./Errors.js";
import {
  makeCaughtUpChangeAuthority,
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "./Model.js";
import type {
  AdmittedChangePage,
  AdmittedChangeRead,
  AdmittedChangeSource,
  AuthorityProjectionMetrics,
  AuthorityObservationProjection,
  CaughtUpChangeAuthority,
  ChangeBudgetInsufficient,
  ChangeProjectionBudget,
  ChangeProjectionMetrics,
  ChangeReadBudget,
  ChangeSourceEpochReplaced,
  ChangeSourceHistoryUnavailable,
  ChangeSourcePage,
  ChangeSourceRead,
  ChangeSourceReadRequest,
  CommittedBatchProjection,
  InvalidationProjector,
  RawChangeBudgetInsufficient,
  ReplayableChangeSource,
} from "./Model.js";

const REFRESH_OPERATIONS = [
  "admitGenerationRefreshEvidence",
  "deriveGenerationRefreshEvidence",
] as const;

type RefreshOperation = (typeof REFRESH_OPERATIONS)[number];

const HARD_BUDGET: ChangeReadBudget = Object.freeze({
  committedBatches: MAX_SOURCE_PAGE_BATCHES,
  sourceTransportBytes: MAX_SOURCE_TRANSPORT_BYTES,
  modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
  modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
  dependencyKeyExaminations: MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  canonicalDependencyBytes: MAX_PROJECTED_CANONICAL_BYTES,
});

const PROJECTION_DIMENSIONS = [
  "modelSemanticWorkUnits",
  "modelSemanticBytes",
  "dependencyKeyExaminations",
  "canonicalDependencyBytes",
] as const;

const CHANGE_BUDGET_DIMENSIONS = [
  "committedBatches",
  "sourceTransportBytes",
  ...PROJECTION_DIMENSIONS,
] as const;

function hardMaximum(dimension: ChangeSourceLimitDimension): number {
  return HARD_BUDGET[dimension];
}

function sourceCorruption(
  reason: ChangeSourceCorruptionError["reason"],
  expectedSequence: bigint | null = null,
  observedSequence: bigint | null = null,
): ChangeSourceCorruptionError {
  return new ChangeSourceCorruptionError({
    operation: "admitChangeSourceRead",
    reason,
    expectedSequence,
    observedSequence,
  });
}

function isBoundedCount(value: number, maximum: number): boolean {
  return isNonNegativeSafeInteger(value) && value <= maximum;
}

function captureChangeSourceReadRequest(
  request: ChangeSourceReadRequest,
): ChangeSourceReadRequest {
  return Object.freeze({
    namespaceId: request.namespaceId,
    syncModelId: request.syncModelId,
    sourceEpoch: request.sourceEpoch,
    requestedAfterSequenceExclusive: request.requestedAfterSequenceExclusive,
  });
}

export function validateChangeReadBudget(
  budget: ChangeReadBudget,
): Result.Result<ChangeReadBudget, ChangeSourceReadError> {
  const captured = Object.freeze({
    committedBatches: budget.committedBatches,
    sourceTransportBytes: budget.sourceTransportBytes,
    modelSemanticWorkUnits: budget.modelSemanticWorkUnits,
    modelSemanticBytes: budget.modelSemanticBytes,
    dependencyKeyExaminations: budget.dependencyKeyExaminations,
    canonicalDependencyBytes: budget.canonicalDependencyBytes,
  });
  for (const dimension of CHANGE_BUDGET_DIMENSIONS) {
    const observed = captured[dimension];
    const maximum = HARD_BUDGET[dimension];
    if (!isPositiveSafeInteger(observed)) {
      return Result.fail(new ChangeSourceIncompatibleError({
        operation: "admitChangeSourceRead",
        reason: "invalidBudget",
      }));
    }
    if (observed > maximum) {
      return Result.fail(new ChangeSourceLimitError({
        operation: "admitChangeSourceRead",
        dimension,
        maximum,
        observed,
      }));
    }
  }
  return Result.succeed(captured);
}

function cursorMatchesRequest(
  cursor: NamespaceCursor,
  request: ChangeSourceReadRequest,
): boolean {
  return cursor.namespaceId === request.namespaceId
    && cursor.syncModelId === request.syncModelId
    && cursor.sourceEpoch === request.sourceEpoch
    && cursor.appliedThroughSequence
      === request.requestedAfterSequenceExclusive;
}

function validateRetentionBoundary(input: {
  readonly replayableAfterSequenceExclusive: SyncSequence;
  readonly retainedFromSequenceInclusive: SyncSequence | null;
  readonly observedLatestSequence: SyncSequence;
}): Result.Result<void, ChangeSourceReadError> {
  if (
    input.replayableAfterSequenceExclusive > input.observedLatestSequence
  ) {
    return Result.fail(sourceCorruption("invalidRetentionBoundary"));
  }
  if (input.retainedFromSequenceInclusive === null) {
    return input.replayableAfterSequenceExclusive
        === input.observedLatestSequence
      ? Result.succeed(undefined)
      : Result.fail(sourceCorruption("invalidRetentionBoundary"));
  }
  const retained = successorSyncSequence(
    input.replayableAfterSequenceExclusive,
  );
  if (
    retained === null
    || retained !== input.retainedFromSequenceInclusive
    || retained > input.observedLatestSequence
  ) {
    return Result.fail(sourceCorruption("invalidRetentionBoundary"));
  }
  return Result.succeed(undefined);
}

function freezeHistoryUnavailable(
  decision: ChangeSourceHistoryUnavailable,
): ChangeSourceHistoryUnavailable {
  const requestedCursor = decision.requestedCursor;
  return Object.freeze({
    _tag: "historyUnavailable",
    requestedCursor: Object.freeze({
      namespaceId: requestedCursor.namespaceId,
      syncModelId: requestedCursor.syncModelId,
      sourceEpoch: requestedCursor.sourceEpoch,
      appliedThroughSequence: requestedCursor.appliedThroughSequence,
    }),
    currentSourceEpoch: decision.currentSourceEpoch,
    observedLatestSequence: decision.observedLatestSequence,
    replayableAfterSequenceExclusive:
      decision.replayableAfterSequenceExclusive,
    retainedFromSequenceInclusive: decision.retainedFromSequenceInclusive,
    reason: "requestedCursorBeforeReplayableHistory",
  });
}

function freezeEpochReplaced(
  decision: ChangeSourceEpochReplaced,
): ChangeSourceEpochReplaced {
  const requestedCursor = decision.requestedCursor;
  return Object.freeze({
    _tag: "epochReplaced",
    requestedCursor: Object.freeze({
      namespaceId: requestedCursor.namespaceId,
      syncModelId: requestedCursor.syncModelId,
      sourceEpoch: requestedCursor.sourceEpoch,
      appliedThroughSequence: requestedCursor.appliedThroughSequence,
    }),
    currentSourceEpoch: decision.currentSourceEpoch,
    observedLatestSequence: decision.observedLatestSequence,
    replayableAfterSequenceExclusive:
      decision.replayableAfterSequenceExclusive,
    retainedFromSequenceInclusive: decision.retainedFromSequenceInclusive,
    reason: "sourceEpochChanged",
  });
}

function freezeBudgetInsufficient(
  decision: ChangeBudgetInsufficient,
): ChangeBudgetInsufficient {
  const requestedCursor = decision.requestedCursor;
  return Object.freeze({
    _tag: "budgetInsufficient",
    requestedCursor: Object.freeze({
      namespaceId: requestedCursor.namespaceId,
      syncModelId: requestedCursor.syncModelId,
      sourceEpoch: requestedCursor.sourceEpoch,
      appliedThroughSequence: requestedCursor.appliedThroughSequence,
    }),
    dimension: decision.dimension,
    provided: decision.provided,
    requiredAtLeast: decision.requiredAtLeast,
    reason: "nextIndivisibleUnitExceedsBudget",
  });
}

function validateResetDecision(
  request: ChangeSourceReadRequest,
  decision: ChangeSourceHistoryUnavailable | ChangeSourceEpochReplaced,
): Result.Result<
  ChangeSourceHistoryUnavailable | ChangeSourceEpochReplaced,
  ChangeSourceReadError
> {
  return Result.gen(function* () {
    const captured = decision._tag === "historyUnavailable"
      ? freezeHistoryUnavailable(decision)
      : freezeEpochReplaced(decision);
    if (!cursorMatchesRequest(captured.requestedCursor, request)) {
      return yield* Result.fail(sourceCorruption("requestMismatch"));
    }
    yield* validateRetentionBoundary(captured);
    if (captured._tag === "historyUnavailable") {
      if (
        captured.currentSourceEpoch !== request.sourceEpoch
        || request.requestedAfterSequenceExclusive
          >= captured.replayableAfterSequenceExclusive
      ) {
        return yield* Result.fail(sourceCorruption("invalidPagePosition"));
      }
      return captured;
    }
    if (captured.currentSourceEpoch === request.sourceEpoch) {
      return yield* Result.fail(sourceCorruption("mixedAuthority"));
    }
    return captured;
  });
}

function validateBudgetDecision(
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  decision: RawChangeBudgetInsufficient,
): Result.Result<ChangeBudgetInsufficient, ChangeSourceReadError> {
  const captured = freezeBudgetInsufficient(decision);
  if (!isRawTransportShortfall(captured)) {
    return Result.fail(sourceCorruption("invalidPagePosition"));
  }
  if (!cursorMatchesRequest(captured.requestedCursor, request)) {
    return Result.fail(sourceCorruption("requestMismatch"));
  }
  const maximum = hardMaximum(captured.dimension);
  const provided = budget[captured.dimension];
  if (
    captured.provided !== provided
    || !isPositiveSafeInteger(captured.requiredAtLeast)
    || captured.requiredAtLeast <= provided
  ) {
    return Result.fail(sourceCorruption("invalidPagePosition"));
  }
  if (captured.requiredAtLeast > maximum) {
    return Result.fail(new ChangeSourceLimitError({
      operation: "admitChangeSourceRead",
      dimension: captured.dimension,
      maximum,
      observed: Math.min(captured.requiredAtLeast, maximum + 1),
    }));
  }
  return Result.succeed(captured);
}

function isRawTransportShortfall(
  decision: { readonly dimension: string },
): boolean {
  return decision.dimension === "sourceTransportBytes";
}

function validatePagePosition<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  request: ChangeSourceReadRequest,
  page: ChangeSourcePage<Payload, AuthorityObservation>,
): Result.Result<void, ChangeSourceReadError> {
  return Result.gen(function* () {
    if (!Array.isArray(page.batches)) {
      return yield* Result.fail(sourceCorruption("invalidPagePosition"));
    }
    if (
      page.namespaceId !== request.namespaceId
      || page.syncModelId !== request.syncModelId
    ) {
      return yield* Result.fail(new ChangeSourceIncompatibleError({
        operation: "admitChangeSourceRead",
        reason: page.namespaceId !== request.namespaceId
          ? "namespaceMismatch"
          : "modelMismatch",
      }));
    }
    if (
      page.sourceEpoch !== request.sourceEpoch
      || page.requestedAfterSequenceExclusive
        !== request.requestedAfterSequenceExclusive
    ) {
      return yield* Result.fail(sourceCorruption("requestMismatch"));
    }
    yield* validateRetentionBoundary(page);
    if (
      page.requestedAfterSequenceExclusive
        < page.replayableAfterSequenceExclusive
    ) {
      return yield* Result.fail(sourceCorruption("invalidPagePosition"));
    }
    if (
      page.requestedAfterSequenceExclusive > page.observedLatestSequence
    ) {
      return yield* Result.fail(new ChangeSourceCursorAheadError({
        operation: "admitChangeSourceRead",
        requestedAfterSequenceExclusive:
          page.requestedAfterSequenceExclusive,
        observedLatestSequence: page.observedLatestSequence,
      }));
    }
    const batchCount = page.batches.length;
    if (
      !page.hasMore
      && (
        page.authorityObservation === null
        || page.authorityObservation === undefined
      )
    ) {
      return yield* Result.fail(sourceCorruption(
        "invalidCaughtUpObservation",
      ));
    }
    if (page.hasMore && page.authorityObservation !== null) {
      return yield* Result.fail(sourceCorruption(
        "invalidCaughtUpObservation",
      ));
    }
    if (batchCount === 0) {
      if (
        page.hasMore
        || page.readThroughSequence
          !== page.requestedAfterSequenceExclusive
        || page.readThroughSequence !== page.observedLatestSequence
      ) {
        return yield* Result.fail(sourceCorruption("invalidPagePosition"));
      }
      return;
    }
    let expected = successorSyncSequence(
      page.requestedAfterSequenceExclusive,
    );
    if (expected === null) {
      return yield* Result.fail(new ChangeSourceSequenceExhaustedError({
        operation: "admitChangeSourceRead",
        requestedAfterSequenceExclusive:
          page.requestedAfterSequenceExclusive,
      }));
    }
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = page.batches[batchIndex];
      if (batch === undefined) {
        return yield* Result.fail(sourceCorruption(
          "nonContiguousPage",
          expected,
          null,
        ));
      }
      if (expected === null) {
        return yield* Result.fail(new ChangeSourceSequenceExhaustedError({
          operation: "admitChangeSourceRead",
          requestedAfterSequenceExclusive: batch.sourceSequence,
        }));
      }
      if (
        batch.namespaceId !== page.namespaceId
        || batch.syncModelId !== page.syncModelId
        || batch.sourceEpoch !== page.sourceEpoch
      ) {
        return yield* Result.fail(sourceCorruption("mixedAuthority"));
      }
      if (batch.sourceSequence !== expected) {
        return yield* Result.fail(sourceCorruption(
          "nonContiguousPage",
          expected,
          batch.sourceSequence,
        ));
      }
      expected = successorSyncSequence(batch.sourceSequence);
    }
    const last = page.batches[batchCount - 1];
    if (
      last === undefined
      || page.readThroughSequence !== last.sourceSequence
      || page.readThroughSequence > page.observedLatestSequence
      || page.hasMore
        !== (page.readThroughSequence < page.observedLatestSequence)
    ) {
      return yield* Result.fail(sourceCorruption("invalidPagePosition"));
    }
  });
}

function validateProjectionMetrics(
  metrics: ChangeProjectionMetrics,
  budget: ChangeProjectionBudget,
  sourceSequence: SyncSequence,
): Result.Result<void, ChangeProjectionError> {
  for (const dimension of PROJECTION_DIMENSIONS) {
    const observed = metrics[dimension];
    const maximum = budget[dimension];
    if (!isBoundedCount(observed, maximum)) {
      return Result.fail(new CommittedChangeInvalidError({
        operation: "projectCommittedBatch",
        reason: "invalidProjectionMetrics",
        sourceSequence,
      }));
    }
  }
  return Result.succeed(undefined);
}

function validateAuthorityMetrics(
  metrics: AuthorityProjectionMetrics,
  budget: Pick<
    ChangeProjectionBudget,
    "modelSemanticWorkUnits" | "modelSemanticBytes"
  >,
  sourceSequence: SyncSequence,
): Result.Result<void, ChangeProjectionError> {
  for (const dimension of [
    "modelSemanticWorkUnits",
    "modelSemanticBytes",
  ] as const) {
    const observed = metrics[dimension];
    const maximum = budget[dimension];
    if (!isBoundedCount(observed, maximum)) {
      return Result.fail(new CommittedChangeInvalidError({
        operation: "projectAuthorityObservation",
        reason: "invalidProjectionMetrics",
        sourceSequence,
      }));
    }
  }
  return Result.succeed(undefined);
}

function makeProjectionBudget(
  consumed: ChangeProjectionMetrics,
  budget: ChangeReadBudget,
): ChangeProjectionBudget {
  return Object.freeze({
    modelSemanticWorkUnits:
      budget.modelSemanticWorkUnits - consumed.modelSemanticWorkUnits,
    modelSemanticBytes:
      budget.modelSemanticBytes - consumed.modelSemanticBytes,
    dependencyKeyExaminations:
      budget.dependencyKeyExaminations
      - consumed.dependencyKeyExaminations,
    canonicalDependencyBytes:
      budget.canonicalDependencyBytes - consumed.canonicalDependencyBytes,
  });
}

function addProjectionMetrics(
  left: ChangeProjectionMetrics,
  right: ChangeProjectionMetrics,
): ChangeProjectionMetrics {
  return Object.freeze({
    modelSemanticWorkUnits:
      left.modelSemanticWorkUnits + right.modelSemanticWorkUnits,
    modelSemanticBytes: left.modelSemanticBytes + right.modelSemanticBytes,
    dependencyKeyExaminations:
      left.dependencyKeyExaminations + right.dependencyKeyExaminations,
    canonicalDependencyBytes:
      left.canonicalDependencyBytes + right.canonicalDependencyBytes,
  });
}

function makeBudgetInsufficient(
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  dimension: ChangeBudgetShortfallDimension,
  requiredAtLeast: number,
): ChangeBudgetInsufficient {
  return freezeBudgetInsufficient({
    _tag: "budgetInsufficient",
    requestedCursor: {
      namespaceId: request.namespaceId,
      syncModelId: request.syncModelId,
      sourceEpoch: request.sourceEpoch,
      appliedThroughSequence: request.requestedAfterSequenceExclusive,
    },
    dimension,
    provided: budget[dimension],
    requiredAtLeast,
    reason: "nextIndivisibleUnitExceedsBudget",
  });
}

interface ProjectionShortfall {
  readonly dimension: ChangeProjectionLimitDimension;
  readonly requiredAtLeast: number;
}

function lowerProjectionShortfall(
  failure: ChangeProjectionError,
  expectedOperation: ChangeProjectionOperation,
  consumed: ChangeProjectionMetrics,
  budget: ChangeReadBudget,
): ProjectionShortfall | null {
  if (failure._tag !== "ChangeProjectionLimitError") return null;
  if (failure.operation !== expectedOperation) return null;
  const dimension = failure.dimension;
  if (
    expectedOperation === "projectAuthorityObservation"
    && dimension !== "modelSemanticWorkUnits"
    && dimension !== "modelSemanticBytes"
  ) {
    return null;
  }
  if (budget[dimension] >= HARD_BUDGET[dimension]) return null;
  const remaining = budget[dimension] - consumed[dimension];
  if (
    failure.maximum !== remaining
    || failure.observed !== failure.maximum + 1
  ) {
    return null;
  }
  return Object.freeze({
    dimension,
    requiredAtLeast: budget[dimension] + 1,
  });
}

function projectBatchWithinCallerBudget<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  projector: InvalidationProjector<Payload, AuthorityObservation>,
  batch: ChangeSourcePage<Payload, AuthorityObservation>["batches"][number],
  consumed: ChangeProjectionMetrics,
  budget: ChangeReadBudget,
): Result.Result<CommittedBatchProjection, ChangeProjectionError> {
  return projectAndValidateBatch(
    projector,
    batch,
    makeProjectionBudget(consumed, budget),
  );
}

function projectAuthorityWithinCallerBudget<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  projector: InvalidationProjector<Payload, AuthorityObservation>,
  page: ChangeSourcePage<Payload, AuthorityObservation> & {
    readonly hasMore: false;
  },
  consumed: ChangeProjectionMetrics,
  budget: ChangeReadBudget,
): Result.Result<AuthorityObservationProjection, ChangeProjectionError> {
  return projectAndValidateAuthority(
    projector,
    page,
    makeProjectionBudget(consumed, budget),
  );
}

function projectionFailureDecision(
  failure: ChangeProjectionError,
  expectedOperation: ChangeProjectionOperation,
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  consumed: ChangeProjectionMetrics,
): ChangeBudgetInsufficient | null {
  const shortfall = lowerProjectionShortfall(
    failure,
    expectedOperation,
    consumed,
    budget,
  );
  if (shortfall === null) return null;
  return makeBudgetInsufficient(
    request,
    budget,
    shortfall.dimension,
    shortfall.requiredAtLeast,
  );
}

type BoundedProjection<A> =
  | Readonly<{
    readonly _tag: "projected";
    readonly projection: A;
  }>
  | Readonly<{
    readonly _tag: "budgetInsufficient";
    readonly decision: ChangeBudgetInsufficient;
  }>;

function classifyBoundedProjection<A>(
  attempted: Result.Result<A, ChangeProjectionError>,
  expectedOperation: ChangeProjectionOperation,
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  consumed: ChangeProjectionMetrics,
): Result.Result<BoundedProjection<A>, ChangeProjectionError> {
  return Result.match(attempted, {
    onFailure: (failure) => {
      const decision = projectionFailureDecision(
        failure,
        expectedOperation,
        request,
        budget,
        consumed,
      );
      return decision === null
        ? Result.fail(failure)
        : Result.succeed(Object.freeze({
          _tag: "budgetInsufficient" as const,
          decision,
        }));
    },
    onSuccess: (projection) => Result.succeed(Object.freeze({
      _tag: "projected" as const,
      projection,
    })),
  });
}

function projectAndValidateBatch<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  projector: InvalidationProjector<Payload, AuthorityObservation>,
  batch: ChangeSourcePage<Payload, AuthorityObservation>["batches"][number],
  remaining: ChangeProjectionBudget,
): Result.Result<CommittedBatchProjection, ChangeProjectionError> {
  return Result.gen(function* () {
    const projected = yield* projector.projectCommittedBatch(
      batch,
      remaining,
    );
    const admittedBatch = projected.admittedBatch;
    const rawMetrics = projected.metrics;
    const projection: CommittedBatchProjection = Object.freeze({
      admittedBatch,
      metrics: Object.freeze({
        modelSemanticWorkUnits: rawMetrics.modelSemanticWorkUnits,
        modelSemanticBytes: rawMetrics.modelSemanticBytes,
        dependencyKeyExaminations: rawMetrics.dependencyKeyExaminations,
        canonicalDependencyBytes: rawMetrics.canonicalDependencyBytes,
      }),
    });
    yield* validateProjectionMetrics(
      projection.metrics,
      remaining,
      batch.sourceSequence,
    );
    const admitted = projection.admittedBatch;
    if (
      admitted.namespaceId !== batch.namespaceId
      || admitted.syncModelId !== batch.syncModelId
      || admitted.sourceEpoch !== batch.sourceEpoch
      || admitted.sourceSequence !== batch.sourceSequence
    ) {
      return yield* Result.fail(new CommittedChangeInvalidError({
        operation: "projectCommittedBatch",
        reason: "projectionAuthorityMismatch",
        sourceSequence: batch.sourceSequence,
      }));
    }
    let canonicalBytes = 0;
    for (const key of admitted.dependencyKeys) {
      canonicalBytes += canonicalBase64UrlDecodedLength(key);
    }
    if (
      projection.metrics.canonicalDependencyBytes !== canonicalBytes
      || projection.metrics.dependencyKeyExaminations
        < admitted.dependencyKeys.length
    ) {
      return yield* Result.fail(new CommittedChangeInvalidError({
        operation: "projectCommittedBatch",
        reason: "invalidProjectionMetrics",
        sourceSequence: batch.sourceSequence,
      }));
    }
    return projection;
  });
}

function projectAndValidateAuthority<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  projector: InvalidationProjector<Payload, AuthorityObservation>,
  page: ChangeSourcePage<Payload, AuthorityObservation> & {
    readonly hasMore: false;
  },
  remaining: ChangeProjectionBudget,
): Result.Result<AuthorityObservationProjection, ChangeProjectionError> {
  return Result.gen(function* () {
    const projected = yield* projector.projectAuthorityObservation({
      namespaceId: page.namespaceId,
      syncModelId: page.syncModelId,
      sourceEpoch: page.sourceEpoch,
      observedThroughSequence: page.readThroughSequence,
      observation: page.authorityObservation,
    }, {
      modelSemanticWorkUnits: remaining.modelSemanticWorkUnits,
      modelSemanticBytes: remaining.modelSemanticBytes,
    });
    const authorityWitness = projected.authorityWitness;
    const rawMetrics = projected.metrics;
    const authority: AuthorityObservationProjection = Object.freeze({
      authorityWitness,
      metrics: Object.freeze({
        modelSemanticWorkUnits: rawMetrics.modelSemanticWorkUnits,
        modelSemanticBytes: rawMetrics.modelSemanticBytes,
      }),
    });
    yield* validateAuthorityMetrics(
      authority.metrics,
      remaining,
      page.readThroughSequence,
    );
    return authority;
  });
}

function freezeAdmittedPage<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  page: ChangeSourcePage<Payload, AuthorityObservation>,
  batches: readonly AdmittedInvalidationBatch[],
  metrics: ChangeProjectionMetrics,
  caughtUpAuthority: CaughtUpChangeAuthority | null,
): AdmittedChangePage {
  const last = batches[batches.length - 1];
  const isPrefix = batches.length < page.batches.length;
  const fields = Object.freeze({
    _tag: "page",
    namespaceId: page.namespaceId,
    syncModelId: page.syncModelId,
    sourceEpoch: page.sourceEpoch,
    requestedAfterSequenceExclusive: page.requestedAfterSequenceExclusive,
    replayableAfterSequenceExclusive:
      page.replayableAfterSequenceExclusive,
    retainedFromSequenceInclusive: page.retainedFromSequenceInclusive,
    observedLatestSequence: page.observedLatestSequence,
    batches: Object.freeze([...batches]),
    readThroughSequence: isPrefix && last !== undefined
      ? last.sourceSequence
      : page.readThroughSequence,
    sourceTransportBytes: page.sourceTransportBytes,
    projectionMetrics: metrics,
  });
  if (isPrefix || page.hasMore) {
    return Object.freeze({
      ...fields,
      hasMore: true,
      caughtUpAuthority: null,
    });
  }
  if (caughtUpAuthority === null) {
    throw new Error("Caught-up admission omitted its authority receipt");
  }
  return Object.freeze({
    ...fields,
    hasMore: false,
    caughtUpAuthority,
  });
}

function admitPage<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  page: ChangeSourcePage<Payload, AuthorityObservation>,
  projector: InvalidationProjector<Payload, AuthorityObservation>,
): Result.Result<AdmittedChangeRead, AdmittedChangeSourceError> {
  return Result.gen(function* () {
    if (!Array.isArray(page.batches)) {
      return yield* Result.fail(sourceCorruption("invalidPagePosition"));
    }
    const batchCount = page.batches.length;
    if (batchCount > MAX_SOURCE_PAGE_BATCHES) {
      return yield* Result.fail(new ChangeSourceLimitError({
        operation: "admitChangeSourceRead",
        dimension: "committedBatches",
        maximum: MAX_SOURCE_PAGE_BATCHES,
        observed: MAX_SOURCE_PAGE_BATCHES + 1,
      }));
    }
    if (
      !isNonNegativeSafeInteger(page.sourceTransportBytes)
    ) {
      return yield* Result.fail(sourceCorruption(
        "invalidTransportMeasurement",
      ));
    }
    if (page.sourceTransportBytes > MAX_SOURCE_TRANSPORT_BYTES) {
      return yield* Result.fail(new ChangeSourceLimitError({
        operation: "admitChangeSourceRead",
        dimension: "sourceTransportBytes",
        maximum: MAX_SOURCE_TRANSPORT_BYTES,
        observed: Math.min(
          page.sourceTransportBytes,
          MAX_SOURCE_TRANSPORT_BYTES + 1,
        ),
      }));
    }
    if (
      batchCount > budget.committedBatches
      || page.sourceTransportBytes > budget.sourceTransportBytes
    ) {
      return yield* Result.fail(sourceCorruption("invalidPagePosition"));
    }
    if (projector.syncModelId !== page.syncModelId) {
      return yield* Result.fail(new ChangeSourceIncompatibleError({
        operation: "admitChangeSourceRead",
        reason: "modelMismatch",
      }));
    }
    yield* validatePagePosition(request, page);

    const admittedBatches: AdmittedInvalidationBatch[] = [];
    let metrics: ChangeProjectionMetrics = Object.freeze({
      modelSemanticWorkUnits: 0,
      modelSemanticBytes: 0,
      dependencyKeyExaminations: 0,
      canonicalDependencyBytes: 0,
    });
    let metricsBeforeLastBatch = metrics;
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = page.batches[batchIndex];
      if (batch === undefined) {
        return yield* Result.fail(sourceCorruption(
          "nonContiguousPage",
        ));
      }
      const projected = yield* classifyBoundedProjection(
        projectBatchWithinCallerBudget(
          projector,
          batch,
          metrics,
          budget,
        ),
        "projectCommittedBatch",
        request,
        budget,
        metrics,
      );
      if (projected._tag === "budgetInsufficient") {
        if (admittedBatches.length > 0) {
          return freezeAdmittedPage(page, admittedBatches, metrics, null);
        }
        return projected.decision;
      }
      const projection = projected.projection;
      const nextMetrics = addProjectionMetrics(
        metrics,
        projection.metrics,
      );
      metricsBeforeLastBatch = metrics;
      metrics = nextMetrics;
      admittedBatches.push(projection.admittedBatch);
    }

    let caughtUpAuthority: CaughtUpChangeAuthority | null = null;
    if (!page.hasMore) {
      const projectedAuthority = yield* classifyBoundedProjection(
        projectAuthorityWithinCallerBudget(
          projector,
          page,
          metrics,
          budget,
        ),
        "projectAuthorityObservation",
        request,
        budget,
        metrics,
      );
      if (projectedAuthority._tag === "budgetInsufficient") {
        if (admittedBatches.length > 1) {
          return freezeAdmittedPage(
            page,
            admittedBatches.slice(0, -1),
            metricsBeforeLastBatch,
            null,
          );
        }
        return projectedAuthority.decision;
      }
      const authority = projectedAuthority.projection;
      const nextMetrics = addProjectionMetrics(metrics, {
        modelSemanticWorkUnits: authority.metrics.modelSemanticWorkUnits,
        modelSemanticBytes: authority.metrics.modelSemanticBytes,
        dependencyKeyExaminations: 0,
        canonicalDependencyBytes: 0,
      });
      metrics = nextMetrics;
      caughtUpAuthority = makeCaughtUpChangeAuthority({
        namespaceId: page.namespaceId,
        syncModelId: page.syncModelId,
        sourceEpoch: page.sourceEpoch,
        readThroughSequence: page.readThroughSequence,
        authorityWitness: authority.authorityWitness,
      });
    }
    return freezeAdmittedPage(
      page,
      admittedBatches,
      metrics,
      caughtUpAuthority,
    );
  });
}

export function admitChangeSourceRead<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  requestInput: ChangeSourceReadRequest,
  budgetInput: ChangeReadBudget,
  read: ChangeSourceRead<Payload, AuthorityObservation>,
  projector: InvalidationProjector<Payload, AuthorityObservation>,
): Result.Result<AdmittedChangeRead, AdmittedChangeSourceError> {
  return Result.gen(function* () {
    const request = captureChangeSourceReadRequest(requestInput);
    const budget = yield* validateChangeReadBudget(budgetInput);
    switch (read._tag) {
      case "historyUnavailable":
      case "epochReplaced":
        return yield* validateResetDecision(request, read);
      case "budgetInsufficient":
        return yield* validateBudgetDecision(request, budget, read);
      case "page":
        return yield* admitPage(request, budget, read, projector);
    }
  });
}

export function makeAdmittedChangeSource<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  source: ReplayableChangeSource<Payload, AuthorityObservation>,
  projector: InvalidationProjector<Payload, AuthorityObservation>,
): AdmittedChangeSource {
  const sourceReadAfter = source.readAfter;
  const syncModelId = projector.syncModelId;
  const projectCommittedBatch = projector.projectCommittedBatch;
  const projectAuthorityObservation =
    projector.projectAuthorityObservation;
  const capturedProjector = Object.freeze({
    syncModelId,
    projectCommittedBatch: (batch, projectionBudget) =>
      projectCommittedBatch.call(projector, batch, projectionBudget),
    projectAuthorityObservation: (input, projectionBudget) =>
      projectAuthorityObservation.call(
        projector,
        input,
        projectionBudget,
      ),
  } satisfies InvalidationProjector<Payload, AuthorityObservation>);
  return Object.freeze({
    readAfter: Effect.fn("QuerySync.AdmittedChangeSource.readAfter")(
      function*(request, budget): Effect.fn.Return<
        AdmittedChangeRead,
        AdmittedChangeSourceError,
        never
      > {
        const capturedRequest = captureChangeSourceReadRequest(request);
        const capturedBudget = yield* Effect.fromResult(
          validateChangeReadBudget(budget),
        );
        const read = yield* sourceReadAfter.call(
          source,
          capturedRequest,
          capturedBudget,
        );
        return yield* Effect.fromResult(admitChangeSourceRead(
          capturedRequest,
          capturedBudget,
          read,
          capturedProjector,
        ));
      },
    ),
  });
}

function refreshError<Operation extends RefreshOperation>(
  operation: Operation,
  reason: InvalidRefreshEvidenceError<Operation>["reason"],
  expectedSequence: bigint | null,
  observedSequence: bigint | null,
): InvalidRefreshEvidenceError<Operation> {
  return new InvalidRefreshEvidenceError<Operation>({
    operation,
    reason,
    expectedSequence,
    observedSequence,
  });
}

function validateRefreshAuthority<Operation extends RefreshOperation>(
  operation: Operation,
  evaluation: QueryEvaluationEvidence,
  observed: {
    readonly namespaceId: string;
    readonly syncModelId: string;
    readonly sourceEpoch: string;
  },
): Result.Result<void, QuerySyncAuthorityError<Operation>> {
  if (observed.namespaceId !== evaluation.namespaceId) {
    return Result.fail(new QuerySyncNamespaceMismatchError<Operation>({
      operation,
      expectedNamespaceId: evaluation.namespaceId,
      observedNamespaceId: observed.namespaceId,
    }));
  }
  if (observed.syncModelId !== evaluation.syncModelId) {
    return Result.fail(new QuerySyncModelMismatchError<Operation>({
      operation,
      expectedSyncModelId: evaluation.syncModelId,
      observedSyncModelId: observed.syncModelId,
    }));
  }
  if (observed.sourceEpoch !== evaluation.sourceEpoch) {
    return Result.fail(new QuerySyncEpochMismatchError<Operation>({
      operation,
      expectedSourceEpoch: evaluation.sourceEpoch,
      observedSourceEpoch: observed.sourceEpoch,
      resetRequired: true,
    }));
  }
  return Result.succeed(undefined);
}

function refreshWorkLimit<Operation extends RefreshOperation>(
  operation: Operation,
  dimension: QuerySyncWorkLimitDimension<Operation>,
  maximum: number,
  observed: number,
): QuerySyncWorkLimitError<Operation> {
  return new QuerySyncWorkLimitError<Operation>({
    operation,
    dimension,
    maximum,
    observed,
  });
}

export function admitGenerationRefreshEvidenceForOperation<
  Operation extends RefreshOperation,
>(
  operation: Operation,
  evaluation: QueryEvaluationEvidence,
  batches: readonly AdmittedInvalidationBatch[],
  authority: CaughtUpChangeAuthority,
): Result.Result<
  GenerationRefreshEvidence,
  | QuerySyncAuthorityError<Operation>
  | InvalidRefreshEvidenceError<Operation>
  | QuerySyncWorkLimitError<Operation>
> {
  return Result.gen(function* () {
    yield* validateRefreshAuthority(operation, evaluation, authority);
    if (authority.readThroughSequence < evaluation.snapshotSequence) {
      return yield* Result.fail(refreshError(
        operation,
        "targetBeforeSnapshot",
        evaluation.snapshotSequence,
        authority.readThroughSequence,
      ));
    }
    if (batches.length > MAX_REFRESH_BATCHES) {
      return yield* Result.fail(refreshWorkLimit(
        operation,
        "refreshBatches",
        MAX_REFRESH_BATCHES,
        batches.length,
      ));
    }
    const intervalLength = authority.readThroughSequence
      - evaluation.snapshotSequence;
    if (intervalLength > BigInt(MAX_REFRESH_BATCHES)) {
      return yield* Result.fail(refreshWorkLimit(
        operation,
        "refreshBatches",
        MAX_REFRESH_BATCHES,
        MAX_REFRESH_BATCHES + 1,
      ));
    }
    const expectedBatchCount = Number(intervalLength);
    if (batches.length < expectedBatchCount) {
      return yield* Result.fail(refreshError(
        operation,
        "missingBatch",
        evaluation.snapshotSequence + BigInt(batches.length + 1),
        null,
      ));
    }
    if (batches.length > expectedBatchCount) {
      return yield* Result.fail(refreshError(
        operation,
        "extraBatch",
        null,
        batches[expectedBatchCount]?.sourceSequence ?? null,
      ));
    }

    const candidateDependencies = new Set(evaluation.dependencyKeys);
    let expectedSequence = querySnapshotAsSyncSequence(
      evaluation.snapshotSequence,
    );
    let relevantThroughSequence: SyncSequence | null = null;
    let keyExaminations = 0;
    let canonicalBytes = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      if (batch === undefined) {
        const successor = successorSyncSequence(expectedSequence);
        return yield* Result.fail(refreshError(
          operation,
          "missingBatch",
          successor,
          null,
        ));
      }
      yield* validateRefreshAuthority(operation, evaluation, batch);
      const successor = successorSyncSequence(expectedSequence);
      if (successor === null || batch.sourceSequence !== successor) {
        return yield* Result.fail(refreshError(
          operation,
          "nonContiguousBatch",
          successor,
          batch.sourceSequence,
        ));
      }
      expectedSequence = successor;
      let relevant = false;
      for (const dependencyKey of batch.dependencyKeys) {
        keyExaminations += 1;
        if (keyExaminations > MAX_REFRESH_KEY_EXAMINATIONS) {
          return yield* Result.fail(refreshWorkLimit(
            operation,
            "refreshKeyExaminations",
            MAX_REFRESH_KEY_EXAMINATIONS,
            keyExaminations,
          ));
        }
        canonicalBytes += canonicalBase64UrlDecodedLength(dependencyKey);
        if (canonicalBytes > MAX_REFRESH_CANONICAL_BYTES) {
          return yield* Result.fail(refreshWorkLimit(
            operation,
            "refreshCanonicalBytes",
            MAX_REFRESH_CANONICAL_BYTES,
            canonicalBytes,
          ));
        }
        if (candidateDependencies.has(dependencyKey)) relevant = true;
      }
      if (relevant) relevantThroughSequence = batch.sourceSequence;
    }

    return makeGenerationRefreshEvidence({
      namespaceId: evaluation.namespaceId,
      syncModelId: evaluation.syncModelId,
      sourceEpoch: evaluation.sourceEpoch,
      descriptor: evaluation.descriptor,
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      evaluationDependencyKeys: evaluation.dependencyKeys,
      refreshedThroughSequence: authority.readThroughSequence,
      relevantThroughSequence,
      authorityWitness: authority.authorityWitness,
    });
  });
}

export function admitGenerationRefreshEvidence(
  evaluation: QueryEvaluationEvidence,
  batches: readonly AdmittedInvalidationBatch[],
  authority: CaughtUpChangeAuthority,
): Result.Result<GenerationRefreshEvidence, RefreshEvidenceAdmissionError> {
  return admitGenerationRefreshEvidenceForOperation(
    "admitGenerationRefreshEvidence",
    evaluation,
    batches,
    authority,
  );
}
