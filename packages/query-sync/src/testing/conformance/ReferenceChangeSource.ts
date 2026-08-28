import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Encoding, Result, SynchronizedRef } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  captureCanonicalDependencyKey,
  captureQueryAuthorityWitness,
  successorSyncSequence,
} from "../../kernel/CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  QueryAuthorityWitness,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "../../kernel/CanonicalValue.js";
import {
  captureAdmittedInvalidationBatch,
} from "../../kernel/Model.js";
import {
  ChangeProjectionLimitError,
  ChangeSourceCursorAheadError,
  ChangeSourceIncompatibleError,
  ChangeSourceLimitError,
  CommittedChangeInvalidError,
} from "../../change/Errors.js";
import type {
  ChangeProjectionError,
  ChangeProjectionLimitDimension,
  ChangeSourceReadError,
} from "../../change/Errors.js";
import {
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "../../change/Model.js";
import type {
  AuthorityObservationInput,
  AuthorityObservationProjection,
  AuthorityProjectionBudget,
  ChangeProjectionBudget,
  ChangeReadBudget,
  ChangeSourcePage,
  ChangeSourceRead,
  ChangeSourceReadRequest,
  CommittedBatchProjection,
  InvalidationProjector,
  RawChangeBudgetInsufficient,
  ReplayableChangeSource,
  SourceCommittedBatch,
} from "../../change/Model.js";

export interface ReferenceCommittedBatchInput<Payload> {
  readonly sourceSequence: SyncSequence;
  readonly payload: Payload;
  readonly transportBytes: number;
}

export interface ReferenceChangeSourceSnapshot<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
> {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly replayableAfterSequenceExclusive: SyncSequence;
  readonly observedLatestSequence: SyncSequence;
  readonly batches: readonly ReferenceCommittedBatchInput<Payload>[];
  readonly authorityObservation: AuthorityObservation;
  readonly authorityTransportBytes: number;
}

export interface ReferenceChangeSourceCapture<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
> {
  readonly capturePayload: (payload: Payload) => Payload;
  readonly captureAuthorityObservation: (
    observation: AuthorityObservation,
  ) => AuthorityObservation;
}

export class ReferenceChangeSourceConstructionError extends Data.TaggedError(
  "ReferenceChangeSourceConstructionError",
)<{
  readonly operation: "makeReferenceReplayableChangeSource";
  readonly reason:
    | "invalidSnapshot"
    | "invalidTransportMeasurement"
    | "sourceTransportLimitExceeded";
  readonly expectedSequence: bigint | null;
  readonly observedSequence: bigint | null;
  readonly maximum: number | null;
  readonly observed: number | null;
}> {}

export class ReferenceChangeSourceAppendError extends Data.TaggedError(
  "ReferenceChangeSourceAppendError",
)<{
  readonly operation: "appendCommittedBatch";
  readonly reason:
    | "invalidTransportMeasurement"
    | "sourceTransportLimitExceeded"
    | "conflictingCommittedBatch";
  readonly expectedSequence: bigint | null;
  readonly observedSequence: bigint | null;
  readonly maximum: number | null;
  readonly observed: number | null;
}> {}

interface OwnedReferenceBatch<Payload> {
  readonly envelope: SourceCommittedBatch<Payload>;
  readonly transportBytes: number;
}

interface OwnedReferenceSnapshot<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
> {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly replayableAfterSequenceExclusive: SyncSequence;
  readonly observedLatestSequence: SyncSequence;
  readonly batches: readonly OwnedReferenceBatch<Payload>[];
  readonly authorityObservation: AuthorityObservation;
  readonly authorityTransportBytes: number;
}

export interface ReferenceReplayableChangeSource<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
> extends ReplayableChangeSource<Payload, AuthorityObservation> {
  readonly appendCommittedBatch: (
    batch: ReferenceCommittedBatchInput<Payload>,
    authorityObservation: AuthorityObservation,
    authorityTransportBytes: number,
  ) => Effect.Effect<void, ReferenceChangeSourceAppendError, never>;
}

const CHANGE_BUDGET_DIMENSIONS = [
  "committedBatches",
  "sourceTransportBytes",
  "modelSemanticWorkUnits",
  "modelSemanticBytes",
  "dependencyKeyExaminations",
  "canonicalDependencyBytes",
] as const;

type ReferenceChangeSourceInvariantReason =
  | "replayDistanceOutsideSnapshot"
  | "ownedBatchMissing"
  | "selectedBatchMissing";

class ReferenceChangeSourceInvariantDefect extends Error {
  readonly _tag = "ReferenceChangeSourceInvariantDefect";

  constructor(readonly reason: ReferenceChangeSourceInvariantReason) {
    super(`Reference change-source invariant failed: ${reason}.`);
    this.name = "ReferenceChangeSourceInvariantDefect";
  }
}

function referenceSnapshotInvariant(
  reason: ReferenceChangeSourceInvariantReason,
): never {
  throw new ReferenceChangeSourceInvariantDefect(reason);
}

function invalidConstructionSnapshot(
  expectedSequence: bigint | null = null,
  observedSequence: bigint | null = null,
): ReferenceChangeSourceConstructionError {
  return new ReferenceChangeSourceConstructionError({
    operation: "makeReferenceReplayableChangeSource",
    reason: "invalidSnapshot",
    expectedSequence,
    observedSequence,
    maximum: null,
    observed: null,
  });
}

function invalidConstructionTransportMeasurement(): ReferenceChangeSourceConstructionError {
  return new ReferenceChangeSourceConstructionError({
    operation: "makeReferenceReplayableChangeSource",
    reason: "invalidTransportMeasurement",
    expectedSequence: null,
    observedSequence: null,
    maximum: null,
    observed: null,
  });
}

function constructionTransportLimit(): ReferenceChangeSourceConstructionError {
  return new ReferenceChangeSourceConstructionError({
    operation: "makeReferenceReplayableChangeSource",
    reason: "sourceTransportLimitExceeded",
    expectedSequence: null,
    observedSequence: null,
    maximum: MAX_SOURCE_TRANSPORT_BYTES,
    observed: MAX_SOURCE_TRANSPORT_BYTES + 1,
  });
}

function invalidAppendTransportMeasurement(): ReferenceChangeSourceAppendError {
  return new ReferenceChangeSourceAppendError({
    operation: "appendCommittedBatch",
    reason: "invalidTransportMeasurement",
    expectedSequence: null,
    observedSequence: null,
    maximum: null,
    observed: null,
  });
}

function appendTransportLimit(): ReferenceChangeSourceAppendError {
  return new ReferenceChangeSourceAppendError({
    operation: "appendCommittedBatch",
    reason: "sourceTransportLimitExceeded",
    expectedSequence: null,
    observedSequence: null,
    maximum: MAX_SOURCE_TRANSPORT_BYTES,
    observed: MAX_SOURCE_TRANSPORT_BYTES + 1,
  });
}

function conflictingAppend(
  expectedSequence: bigint | null,
  observedSequence: bigint,
): ReferenceChangeSourceAppendError {
  return new ReferenceChangeSourceAppendError({
    operation: "appendCommittedBatch",
    reason: "conflictingCommittedBatch",
    expectedSequence,
    observedSequence,
    maximum: null,
    observed: null,
  });
}

function validateTransportMeasurement<E>(
  value: number,
  invalid: () => E,
  excessive: () => E,
): Result.Result<void, E> {
  if (!isNonNegativeSafeInteger(value)) {
    return Result.fail(invalid());
  }
  if (value > MAX_SOURCE_TRANSPORT_BYTES) {
    return Result.fail(excessive());
  }
  return Result.succeed(undefined);
}

function validateReferenceBudget(
  budget: ChangeReadBudget,
): Result.Result<ChangeReadBudget, ChangeSourceReadError> {
  const maxima: ChangeReadBudget = {
    committedBatches: MAX_SOURCE_PAGE_BATCHES,
    sourceTransportBytes: MAX_SOURCE_TRANSPORT_BYTES,
    modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
    modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
    dependencyKeyExaminations: MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
    canonicalDependencyBytes: MAX_PROJECTED_CANONICAL_BYTES,
  };
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
    const maximum = maxima[dimension];
    if (!isPositiveSafeInteger(observed)) {
      return Result.fail(new ChangeSourceIncompatibleError({
        operation: "readAfter",
        reason: "invalidBudget",
      }));
    }
    if (observed > maximum) {
      return Result.fail(new ChangeSourceLimitError({
        operation: "readAfter",
        dimension,
        maximum,
        observed,
      }));
    }
  }
  return Result.succeed(captured);
}

function ownReferenceSnapshot<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  input: ReferenceChangeSourceSnapshot<Payload, AuthorityObservation>,
  capture: ReferenceChangeSourceCapture<Payload, AuthorityObservation>,
): Result.Result<
  OwnedReferenceSnapshot<Payload, AuthorityObservation>,
  ReferenceChangeSourceConstructionError
> {
  return Result.gen(function* () {
    const namespaceId = input.namespaceId;
    const syncModelId = input.syncModelId;
    const sourceEpoch = input.sourceEpoch;
    const replayableAfterSequenceExclusive =
      input.replayableAfterSequenceExclusive;
    const observedLatestSequence = input.observedLatestSequence;
    const authorityObservation = input.authorityObservation;
    const authorityTransportBytes = input.authorityTransportBytes;
    const capturePayload = capture.capturePayload;
    const captureAuthorityObservation = capture.captureAuthorityObservation;
    const inputBatches = input.batches;
    const batchCount = inputBatches.length;
    const capturedBatchInputs: ReferenceCommittedBatchInput<Payload>[] = [];
    for (let index = 0; index < batchCount; index += 1) {
      const batch = inputBatches[index];
      if (batch === undefined) {
        return yield* Result.fail(invalidConstructionSnapshot());
      }
      capturedBatchInputs.push(Object.freeze({
        sourceSequence: batch.sourceSequence,
        payload: batch.payload,
        transportBytes: batch.transportBytes,
      }));
    }

    if (
      replayableAfterSequenceExclusive > observedLatestSequence
    ) {
      return yield* Result.fail(invalidConstructionSnapshot());
    }
    yield* validateTransportMeasurement(
      authorityTransportBytes,
      invalidConstructionTransportMeasurement,
      constructionTransportLimit,
    );

    const batches: OwnedReferenceBatch<Payload>[] = [];
    let expected = successorSyncSequence(
      replayableAfterSequenceExclusive,
    );
    for (const batch of capturedBatchInputs) {
      if (
        expected === null
        || batch.sourceSequence !== expected
      ) {
        return yield* Result.fail(invalidConstructionSnapshot(
          expected,
          batch.sourceSequence,
        ));
      }
      yield* validateTransportMeasurement(
        batch.transportBytes,
        invalidConstructionTransportMeasurement,
        constructionTransportLimit,
      );
      batches.push(Object.freeze({
        envelope: Object.freeze({
          namespaceId,
          syncModelId,
          sourceEpoch,
          sourceSequence: batch.sourceSequence,
          payload: capturePayload(batch.payload),
        }),
        transportBytes: batch.transportBytes,
      }));
      expected = successorSyncSequence(batch.sourceSequence);
    }
    const last = batches[batches.length - 1];
    if (
      (last === undefined
        && replayableAfterSequenceExclusive !== observedLatestSequence)
      || (last !== undefined
        && last.envelope.sourceSequence !== observedLatestSequence)
    ) {
      return yield* Result.fail(invalidConstructionSnapshot());
    }
    if (
      last !== undefined
      && last.transportBytes + authorityTransportBytes
        > MAX_SOURCE_TRANSPORT_BYTES
    ) {
      return yield* Result.fail(constructionTransportLimit());
    }
    return Object.freeze({
      namespaceId,
      syncModelId,
      sourceEpoch,
      replayableAfterSequenceExclusive,
      observedLatestSequence,
      batches: Object.freeze(batches),
      authorityObservation: captureAuthorityObservation(
        authorityObservation,
      ),
      authorityTransportBytes,
    });
  });
}

function requestedCursor(request: ChangeSourceReadRequest) {
  return Object.freeze({
    namespaceId: request.namespaceId,
    syncModelId: request.syncModelId,
    sourceEpoch: request.sourceEpoch,
    appliedThroughSequence: request.requestedAfterSequenceExclusive,
  });
}

function captureReadRequest(
  request: ChangeSourceReadRequest,
): ChangeSourceReadRequest {
  return Object.freeze({
    namespaceId: request.namespaceId,
    syncModelId: request.syncModelId,
    sourceEpoch: request.sourceEpoch,
    requestedAfterSequenceExclusive: request.requestedAfterSequenceExclusive,
  });
}

function budgetInsufficient(
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  requiredAtLeast: number,
): RawChangeBudgetInsufficient {
  return Object.freeze({
    _tag: "budgetInsufficient",
    requestedCursor: requestedCursor(request),
    dimension: "sourceTransportBytes",
    provided: budget.sourceTransportBytes,
    requiredAtLeast,
    reason: "nextIndivisibleUnitExceedsBudget",
  });
}

function readSnapshot<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  snapshot: OwnedReferenceSnapshot<Payload, AuthorityObservation>,
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
): Result.Result<
  ChangeSourceRead<Payload, AuthorityObservation>,
  ChangeSourceReadError
> {
  return Result.gen(function* () {
    if (request.namespaceId !== snapshot.namespaceId) {
      return yield* Result.fail(new ChangeSourceIncompatibleError({
        operation: "readAfter",
        reason: "namespaceMismatch",
      }));
    }
    if (request.syncModelId !== snapshot.syncModelId) {
      return yield* Result.fail(new ChangeSourceIncompatibleError({
        operation: "readAfter",
        reason: "modelMismatch",
      }));
    }
    const retainedFrom = snapshot.batches[0]?.envelope.sourceSequence ?? null;
    if (request.sourceEpoch !== snapshot.sourceEpoch) {
      return Object.freeze({
        _tag: "epochReplaced",
        requestedCursor: requestedCursor(request),
        currentSourceEpoch: snapshot.sourceEpoch,
        observedLatestSequence: snapshot.observedLatestSequence,
        replayableAfterSequenceExclusive:
          snapshot.replayableAfterSequenceExclusive,
        retainedFromSequenceInclusive: retainedFrom,
        reason: "sourceEpochChanged",
      });
    }
    if (
      request.requestedAfterSequenceExclusive
        < snapshot.replayableAfterSequenceExclusive
    ) {
      return Object.freeze({
        _tag: "historyUnavailable",
        requestedCursor: requestedCursor(request),
        currentSourceEpoch: snapshot.sourceEpoch,
        observedLatestSequence: snapshot.observedLatestSequence,
        replayableAfterSequenceExclusive:
          snapshot.replayableAfterSequenceExclusive,
        retainedFromSequenceInclusive: retainedFrom,
        reason: "requestedCursorBeforeReplayableHistory",
      });
    }
    if (
      request.requestedAfterSequenceExclusive
        > snapshot.observedLatestSequence
    ) {
      return yield* Result.fail(new ChangeSourceCursorAheadError({
        operation: "readAfter",
        requestedAfterSequenceExclusive:
          request.requestedAfterSequenceExclusive,
        observedLatestSequence: snapshot.observedLatestSequence,
      }));
    }

    const replayDistance = request.requestedAfterSequenceExclusive
      - snapshot.replayableAfterSequenceExclusive;
    if (
      replayDistance < 0n
      || replayDistance > BigInt(snapshot.batches.length)
    ) {
      return referenceSnapshotInvariant("replayDistanceOutsideSnapshot");
    }
    const startIndex = Number(replayDistance);
    const selected: OwnedReferenceBatch<Payload>[] = [];
    let transportBytes = 0;
    for (
      let batchIndex = startIndex;
      batchIndex < snapshot.batches.length;
      batchIndex += 1
    ) {
      const candidate = snapshot.batches[batchIndex];
      if (candidate === undefined) {
        return referenceSnapshotInvariant("ownedBatchMissing");
      }
      if (selected.length >= budget.committedBatches) break;
      if (
        transportBytes + candidate.transportBytes
          > budget.sourceTransportBytes
      ) {
        if (selected.length === 0) {
          return budgetInsufficient(
            request,
            budget,
            candidate.transportBytes,
          );
        }
        break;
      }
      selected.push(candidate);
      transportBytes += candidate.transportBytes;
    }

    let readThrough = selected[selected.length - 1]?.envelope.sourceSequence
      ?? request.requestedAfterSequenceExclusive;
    let hasMore = readThrough < snapshot.observedLatestSequence;
    if (
      !hasMore
      && transportBytes + snapshot.authorityTransportBytes
        > budget.sourceTransportBytes
    ) {
      if (selected.length <= 1) {
        return budgetInsufficient(
          request,
          budget,
          transportBytes + snapshot.authorityTransportBytes,
        );
      }
      const removed = selected.pop();
      if (removed === undefined) {
        return referenceSnapshotInvariant("selectedBatchMissing");
      }
      transportBytes -= removed.transportBytes;
      readThrough = selected[selected.length - 1]?.envelope.sourceSequence
        ?? request.requestedAfterSequenceExclusive;
      hasMore = true;
    }

    const pageFields = {
      _tag: "page" as const,
      namespaceId: snapshot.namespaceId,
      syncModelId: snapshot.syncModelId,
      sourceEpoch: snapshot.sourceEpoch,
      requestedAfterSequenceExclusive:
        request.requestedAfterSequenceExclusive,
      replayableAfterSequenceExclusive:
        snapshot.replayableAfterSequenceExclusive,
      retainedFromSequenceInclusive: retainedFrom,
      observedLatestSequence: snapshot.observedLatestSequence,
      batches: Object.freeze(selected.map((batch) => batch.envelope)),
      readThroughSequence: readThrough,
    };
    if (hasMore) {
      const page: ChangeSourcePage<Payload, AuthorityObservation> =
        Object.freeze({
          ...pageFields,
          hasMore: true,
          authorityObservation: null,
          sourceTransportBytes: transportBytes,
        });
      return page;
    }
    const page: ChangeSourcePage<Payload, AuthorityObservation> =
      Object.freeze({
        ...pageFields,
        hasMore: false,
        authorityObservation: snapshot.authorityObservation,
        sourceTransportBytes:
          transportBytes + snapshot.authorityTransportBytes,
      });
    return page;
  });
}

export const makeReferenceReplayableChangeSource = Effect.fn(
  "QuerySync.ReferenceChangeSource.make",
)(function*<
  Payload,
  AuthorityObservation extends NonNullable<unknown>,
>(
  input: ReferenceChangeSourceSnapshot<Payload, AuthorityObservation>,
  capture: ReferenceChangeSourceCapture<Payload, AuthorityObservation>,
): Effect.fn.Return<
  ReferenceReplayableChangeSource<Payload, AuthorityObservation>,
  ReferenceChangeSourceConstructionError,
  never
> {
    const capturePayload = capture.capturePayload;
    const captureAuthorityObservation =
      capture.captureAuthorityObservation;
    const capturedSourcePolicy = Object.freeze({
      capturePayload: (payload: Payload) =>
        capturePayload.call(capture, payload),
      captureAuthorityObservation: (observation: AuthorityObservation) =>
        captureAuthorityObservation.call(capture, observation),
    } satisfies ReferenceChangeSourceCapture<
      Payload,
      AuthorityObservation
    >);
    const owned = yield* Effect.fromResult(ownReferenceSnapshot(
      input,
      capturedSourcePolicy,
    ));
    const snapshotRef = yield* SynchronizedRef.make(owned);

    const readAfter = Effect.fn("QuerySync.ReferenceChangeSource.readAfter")(
      function*(request, budgetInput): Effect.fn.Return<
        ChangeSourceRead<Payload, AuthorityObservation>,
        ChangeSourceReadError,
        never
      > {
        const capturedRequest = captureReadRequest(request);
        const budget = yield* Effect.fromResult(
          validateReferenceBudget(budgetInput),
        );
        const snapshot = yield* SynchronizedRef.get(snapshotRef);
        return yield* Effect.fromResult(readSnapshot(
          snapshot,
          capturedRequest,
          budget,
        ));
      },
    );

    const appendCommittedBatch = Effect.fn(
      "QuerySync.ReferenceChangeSource.appendCommittedBatch",
    )(function*(
      batch: ReferenceCommittedBatchInput<Payload>,
      authorityObservation: AuthorityObservation,
      authorityTransportBytes: number,
    ): Effect.fn.Return<void, ReferenceChangeSourceAppendError, never> {
      const sourceSequence = batch.sourceSequence;
      const payload = batch.payload;
      const transportBytes = batch.transportBytes;
      yield* Effect.fromResult(validateTransportMeasurement(
        transportBytes,
        invalidAppendTransportMeasurement,
        appendTransportLimit,
      ));
      yield* Effect.fromResult(
        validateTransportMeasurement(
          authorityTransportBytes,
          invalidAppendTransportMeasurement,
          appendTransportLimit,
        ),
      );
      if (
        transportBytes + authorityTransportBytes
          > MAX_SOURCE_TRANSPORT_BYTES
      ) {
        return yield* appendTransportLimit();
      }
      const ownedPayload = capturedSourcePolicy.capturePayload(payload);
      const ownedAuthority = capturedSourcePolicy.captureAuthorityObservation(
        authorityObservation,
      );
      const result = yield* SynchronizedRef.modify(
        snapshotRef,
        (snapshot): readonly [
          Result.Result<void, ReferenceChangeSourceAppendError>,
          OwnedReferenceSnapshot<Payload, AuthorityObservation>,
        ] => {
          const expected = successorSyncSequence(
            snapshot.observedLatestSequence,
          );
          if (expected === null || sourceSequence !== expected) {
            return [
              Result.fail(conflictingAppend(
                expected,
                sourceSequence,
              )),
              snapshot,
            ];
          }
          const nextBatch: OwnedReferenceBatch<Payload> = Object.freeze({
            envelope: Object.freeze({
              namespaceId: snapshot.namespaceId,
              syncModelId: snapshot.syncModelId,
              sourceEpoch: snapshot.sourceEpoch,
              sourceSequence,
              payload: ownedPayload,
            }),
            transportBytes,
          });
          const next: OwnedReferenceSnapshot<
            Payload,
            AuthorityObservation
          > = Object.freeze({
            ...snapshot,
            observedLatestSequence: sourceSequence,
            batches: Object.freeze([...snapshot.batches, nextBatch]),
            authorityObservation: ownedAuthority,
            authorityTransportBytes,
          });
          return [Result.succeed(undefined), next];
        },
      );
      return yield* Effect.fromResult(result);
    });

  return Object.freeze({ readAfter, appendCommittedBatch });
});

export interface KeyValueCommittedChange {
  readonly key: string;
  readonly kind: "set" | "delete";
}

export interface KeyValueCommittedPayload {
  readonly changes: readonly KeyValueCommittedChange[];
}

export interface KeyValueAuthorityObservation {
  readonly revision: number;
  readonly partitions: readonly string[];
}

export interface GraphCommittedEdgeChange {
  readonly from: string;
  readonly label: string;
  readonly to: string;
  readonly kind: "upsert" | "delete";
}

export interface GraphCommittedPayload {
  readonly edges: readonly GraphCommittedEdgeChange[];
}

export interface GraphAuthorityObservation {
  readonly head: string;
  readonly vertices: readonly string[];
}

/**
 * Retains the complete admissible shape plus the final member needed to prove
 * a semantic hard-limit overflow. Tails beyond that proof are intentionally
 * unreachable through this reference adapter.
 */
function captureModelProofPrefix<
  A extends NonNullable<unknown>,
  B,
>(
  values: readonly A[],
  capture: (value: A) => B,
): readonly B[] {
  const length = Math.min(
    values.length,
    MAX_MODEL_SEMANTIC_WORK_UNITS,
  );
  const captured: B[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      captured.length += 1;
      continue;
    }
    captured.push(capture(value));
  }
  return Object.freeze(captured);
}

export function captureKeyValueCommittedPayload(
  payload: KeyValueCommittedPayload,
): KeyValueCommittedPayload {
  return Object.freeze({
    changes: captureModelProofPrefix(
      payload.changes,
      (change) => Object.freeze({
        key: change.key,
        kind: change.kind,
      }),
    ),
  });
}

export function captureKeyValueAuthorityObservation(
  observation: KeyValueAuthorityObservation,
): KeyValueAuthorityObservation {
  return Object.freeze({
    revision: observation.revision,
    partitions: captureModelProofPrefix(
      observation.partitions,
      (partition) => partition,
    ),
  });
}

export function captureGraphCommittedPayload(
  payload: GraphCommittedPayload,
): GraphCommittedPayload {
  return Object.freeze({
    edges: captureModelProofPrefix(
      payload.edges,
      (edge) => Object.freeze({
        from: edge.from,
        label: edge.label,
        to: edge.to,
        kind: edge.kind,
      }),
    ),
  });
}

export function captureGraphAuthorityObservation(
  observation: GraphAuthorityObservation,
): GraphAuthorityObservation {
  return Object.freeze({
    head: observation.head,
    vertices: captureModelProofPrefix(
      observation.vertices,
      (vertex) => vertex,
    ),
  });
}

interface Utf8Measurement {
  readonly byteLength: number;
  readonly exceeded: boolean;
  readonly containsNull: boolean;
}

function measureUtf8AtMost(
  value: string,
  maximum: number,
): Utf8Measurement | null {
  let bytes = 0;
  let containsNull = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) containsNull = true;
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return null;
      bytes += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return null;
    } else {
      bytes += 3;
    }
    if (bytes > maximum) {
      return Object.freeze({
        byteLength: maximum + 1,
        exceeded: true,
        containsNull,
      });
    }
  }
  return Object.freeze({
    byteLength: bytes,
    exceeded: false,
    containsNull,
  });
}

function invalidProjection(
  operation: CommittedChangeInvalidError["operation"],
  reason: CommittedChangeInvalidError["reason"],
  sourceSequence: SyncSequence,
): CommittedChangeInvalidError {
  return new CommittedChangeInvalidError({
    operation,
    reason,
    sourceSequence,
  });
}

function projectionLimit(
  operation: ChangeProjectionLimitError["operation"],
  dimension: ChangeProjectionLimitDimension,
  maximum: number,
  observed: number,
): ChangeProjectionLimitError {
  return new ChangeProjectionLimitError({
    operation,
    dimension,
    maximum,
    observed: Math.min(observed, maximum + 1),
  });
}

function appendUtf8Bytes(
  output: number[],
  value: string,
  maximumLength: number,
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      output.push(codeUnit);
    } else if (codeUnit <= 0x7ff) {
      output.push(0xc0 | (codeUnit >> 6), 0x80 | (codeUnit & 0x3f));
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      const codePoint = 0x1_0000
        + ((codeUnit - 0xd800) << 10)
        + (next - 0xdc00);
      output.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    } else {
      output.push(
        0xe0 | (codeUnit >> 12),
        0x80 | ((codeUnit >> 6) & 0x3f),
        0x80 | (codeUnit & 0x3f),
      );
    }
    if (output.length > maximumLength) return false;
  }
  return true;
}

function appendLengthPrefixedText(
  output: number[],
  value: string,
): boolean {
  const lengthIndex = output.length;
  output.push(0);
  if (output.length > 32) return false;
  const valueStart = output.length;
  if (!appendUtf8Bytes(output, value, 32)) return false;
  const byteLength = output.length - valueStart;
  if (byteLength > 255 || output.length > 32) return false;
  output[lengthIndex] = byteLength;
  return true;
}

function exactAuthorityWitness(
  modelTag: 0x47 | 0x4b,
  primary: number | string,
  members: readonly string[],
  sourceSequence: SyncSequence,
): Result.Result<QueryAuthorityWitness, ChangeProjectionError> {
  const encoded: number[] = [modelTag];
  if (typeof primary === "number") {
    const revision = BigInt(primary);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      encoded.push(Number((revision >> shift) & 0xffn));
    }
  } else if (!appendLengthPrefixedText(encoded, primary)) {
    return Result.fail(invalidProjection(
      "projectAuthorityObservation",
      "invalidAuthorityObservation",
      sourceSequence,
    ));
  }
  if (members.length > 255 || encoded.length >= 32) {
    return Result.fail(invalidProjection(
      "projectAuthorityObservation",
      "invalidAuthorityObservation",
      sourceSequence,
    ));
  }
  encoded.push(members.length);
  for (const member of members) {
    if (!appendLengthPrefixedText(encoded, member)) {
      return Result.fail(invalidProjection(
        "projectAuthorityObservation",
        "invalidAuthorityObservation",
        sourceSequence,
      ));
    }
  }
  const bytes = new Uint8Array(32);
  bytes.set(encoded);
  return captureQueryAuthorityWitness(Encoding.encodeBase64Url(bytes));
}

function captureDependencyKey(
  modelPrefix: "kv-change" | "graph-edge" | "graph-node",
  parts: readonly string[],
): Result.Result<CanonicalDependencyKey, ChangeProjectionError> {
  return captureCanonicalDependencyKey(Encoding.encodeBase64Url(
    [modelPrefix, ...parts].join("\0"),
  ));
}

export function captureKeyValueChangeDependencyKey(
  key: string,
): Result.Result<CanonicalDependencyKey, ChangeProjectionError> {
  return captureDependencyKey("kv-change", [key]);
}

export function captureGraphEdgeDependencyKey(
  from: string,
  label: string,
  to: string,
): Result.Result<CanonicalDependencyKey, ChangeProjectionError> {
  return captureDependencyKey("graph-edge", [from, label, to]);
}

export function captureGraphNodeDependencyKey(
  node: string,
): Result.Result<CanonicalDependencyKey, ChangeProjectionError> {
  return captureDependencyKey("graph-node", [node]);
}

function projectKeyValueBatch(
  batch: SourceCommittedBatch<KeyValueCommittedPayload>,
  budget: ChangeProjectionBudget,
): Result.Result<CommittedBatchProjection, ChangeProjectionError> {
  return Result.gen(function* () {
    const payload: unknown = batch.payload;
    if (!isNonArrayRecord(payload) || !Array.isArray(payload.changes)) {
      return yield* Result.fail(invalidProjection(
        "projectCommittedBatch",
        "invalidPayload",
        batch.sourceSequence,
      ));
    }
    let semanticWork = 1;
    let semanticBytes = 0;
    let examinations = 0;
    let canonicalBytes = 0;
    const keysBySource = new Map<string, CanonicalDependencyKey>();
    if (semanticWork > budget.modelSemanticWorkUnits) {
      return yield* Result.fail(projectionLimit(
        "projectCommittedBatch",
        "modelSemanticWorkUnits",
        budget.modelSemanticWorkUnits,
        semanticWork,
      ));
    }
    for (
      let changeIndex = 0;
      changeIndex < payload.changes.length;
      changeIndex += 1
    ) {
      const value = payload.changes[changeIndex];
      semanticWork += 1;
      if (semanticWork > budget.modelSemanticWorkUnits) {
        return yield* Result.fail(projectionLimit(
          "projectCommittedBatch",
          "modelSemanticWorkUnits",
          budget.modelSemanticWorkUnits,
          semanticWork,
        ));
      }
      if (!isNonArrayRecord(value)) {
        return yield* Result.fail(invalidProjection(
          "projectCommittedBatch",
          "invalidPayload",
          batch.sourceSequence,
        ));
      }
      const key = value.key;
      const kind = value.kind;
      if (
        typeof key !== "string"
        || (kind !== "set" && kind !== "delete")
      ) {
        return yield* Result.fail(invalidProjection(
          "projectCommittedBatch",
          "invalidPayload",
          batch.sourceSequence,
        ));
      }
      const keyMeasurement = measureUtf8AtMost(
        key,
        budget.modelSemanticBytes - semanticBytes,
      );
      if (
        keyMeasurement === null
        || key.length === 0
        || keyMeasurement.containsNull
      ) {
        return yield* Result.fail(invalidProjection(
          "projectCommittedBatch",
          "invalidPayload",
          batch.sourceSequence,
        ));
      }
      semanticBytes += keyMeasurement.byteLength;
      if (keyMeasurement.exceeded) {
        return yield* Result.fail(projectionLimit(
          "projectCommittedBatch",
          "modelSemanticBytes",
          budget.modelSemanticBytes,
          budget.modelSemanticBytes + 1,
        ));
      }
      semanticBytes += 1;
      if (semanticBytes > budget.modelSemanticBytes) {
        return yield* Result.fail(projectionLimit(
          "projectCommittedBatch",
          "modelSemanticBytes",
          budget.modelSemanticBytes,
          semanticBytes,
        ));
      }
      examinations += 1;
      if (examinations > budget.dependencyKeyExaminations) {
        return yield* Result.fail(projectionLimit(
          "projectCommittedBatch",
          "dependencyKeyExaminations",
          budget.dependencyKeyExaminations,
          examinations,
        ));
      }
      if (!keysBySource.has(key)) {
        const requiredCanonicalBytes = 10 + keyMeasurement.byteLength;
        if (
          canonicalBytes + requiredCanonicalBytes
            > budget.canonicalDependencyBytes
        ) {
          return yield* Result.fail(projectionLimit(
            "projectCommittedBatch",
            "canonicalDependencyBytes",
            budget.canonicalDependencyBytes,
            budget.canonicalDependencyBytes + 1,
          ));
        }
        const dependencyKey = yield* captureKeyValueChangeDependencyKey(
          key,
        );
        keysBySource.set(key, dependencyKey);
        canonicalBytes += canonicalBase64UrlDecodedLength(dependencyKey);
      }
    }
    const admittedBatch = yield* captureAdmittedInvalidationBatch({
      namespaceId: batch.namespaceId,
      syncModelId: batch.syncModelId,
      sourceEpoch: batch.sourceEpoch,
      sourceSequence: batch.sourceSequence,
      dependencyKeys: [...keysBySource.values()],
    });
    return Object.freeze({
      admittedBatch,
      metrics: Object.freeze({
        modelSemanticWorkUnits: semanticWork,
        modelSemanticBytes: semanticBytes,
        dependencyKeyExaminations: examinations,
        canonicalDependencyBytes: canonicalBytes,
      }),
    });
  });
}

function projectGraphBatch(
  batch: SourceCommittedBatch<GraphCommittedPayload>,
  budget: ChangeProjectionBudget,
): Result.Result<CommittedBatchProjection, ChangeProjectionError> {
  return Result.gen(function* () {
    const payload: unknown = batch.payload;
    if (!isNonArrayRecord(payload) || !Array.isArray(payload.edges)) {
      return yield* Result.fail(invalidProjection(
        "projectCommittedBatch",
        "invalidPayload",
        batch.sourceSequence,
      ));
    }
    let semanticWork = 1;
    let semanticBytes = 0;
    let examinations = 0;
    let canonicalBytes = 0;
    const keysBySource = new Map<string, CanonicalDependencyKey>();
    if (semanticWork > budget.modelSemanticWorkUnits) {
      return yield* Result.fail(projectionLimit(
        "projectCommittedBatch",
        "modelSemanticWorkUnits",
        budget.modelSemanticWorkUnits,
        semanticWork,
      ));
    }
    for (
      let edgeIndex = 0;
      edgeIndex < payload.edges.length;
      edgeIndex += 1
    ) {
      const value = payload.edges[edgeIndex];
      semanticWork += 1;
      if (semanticWork > budget.modelSemanticWorkUnits) {
        return yield* Result.fail(projectionLimit(
          "projectCommittedBatch",
          "modelSemanticWorkUnits",
          budget.modelSemanticWorkUnits,
          semanticWork,
        ));
      }
      if (!isNonArrayRecord(value)) {
        return yield* Result.fail(invalidProjection(
          "projectCommittedBatch",
          "invalidPayload",
          batch.sourceSequence,
        ));
      }
      const from = value.from;
      const label = value.label;
      const to = value.to;
      const kind = value.kind;
      if (
        typeof from !== "string"
        || typeof label !== "string"
        || typeof to !== "string"
        || (kind !== "upsert" && kind !== "delete")
      ) {
        return yield* Result.fail(invalidProjection(
          "projectCommittedBatch",
          "invalidPayload",
          batch.sourceSequence,
        ));
      }
      const textParts = [from, label, to];
      const measuredTextBytes: number[] = [];
      for (const text of textParts) {
        const measurement = measureUtf8AtMost(
          text,
          budget.modelSemanticBytes - semanticBytes,
        );
        if (
          measurement === null
          || text.length === 0
          || measurement.containsNull
        ) {
          return yield* Result.fail(invalidProjection(
            "projectCommittedBatch",
            "invalidPayload",
            batch.sourceSequence,
          ));
        }
        semanticBytes += measurement.byteLength;
        if (measurement.exceeded) {
          return yield* Result.fail(projectionLimit(
            "projectCommittedBatch",
            "modelSemanticBytes",
            budget.modelSemanticBytes,
            budget.modelSemanticBytes + 1,
          ));
        }
        measuredTextBytes.push(measurement.byteLength);
      }
      semanticBytes += 1;
      if (semanticBytes > budget.modelSemanticBytes) {
        return yield* Result.fail(projectionLimit(
          "projectCommittedBatch",
          "modelSemanticBytes",
          budget.modelSemanticBytes,
          semanticBytes,
        ));
      }
      const fromBytes = measuredTextBytes[0] ?? 0;
      const labelBytes = measuredTextBytes[1] ?? 0;
      const toBytes = measuredTextBytes[2] ?? 0;
      const projected = [
        {
          identity: `graph-edge\0${from}\0${label}\0${to}`,
          decodedBytes: 13 + fromBytes + labelBytes + toBytes,
          capture: () => captureGraphEdgeDependencyKey(
            from,
            label,
            to,
          ),
        },
        {
          identity: `graph-node\0${from}`,
          decodedBytes: 11 + fromBytes,
          capture: () => captureGraphNodeDependencyKey(from),
        },
        {
          identity: `graph-node\0${to}`,
          decodedBytes: 11 + toBytes,
          capture: () => captureGraphNodeDependencyKey(to),
        },
      ];
      for (const candidate of projected) {
        examinations += 1;
        if (examinations > budget.dependencyKeyExaminations) {
          return yield* Result.fail(projectionLimit(
            "projectCommittedBatch",
            "dependencyKeyExaminations",
            budget.dependencyKeyExaminations,
            examinations,
          ));
        }
        if (!keysBySource.has(candidate.identity)) {
          if (
            canonicalBytes + candidate.decodedBytes
              > budget.canonicalDependencyBytes
          ) {
            return yield* Result.fail(projectionLimit(
              "projectCommittedBatch",
              "canonicalDependencyBytes",
              budget.canonicalDependencyBytes,
              budget.canonicalDependencyBytes + 1,
            ));
          }
          const dependencyKey = yield* candidate.capture();
          keysBySource.set(candidate.identity, dependencyKey);
          canonicalBytes += canonicalBase64UrlDecodedLength(dependencyKey);
        }
      }
    }
    const admittedBatch = yield* captureAdmittedInvalidationBatch({
      namespaceId: batch.namespaceId,
      syncModelId: batch.syncModelId,
      sourceEpoch: batch.sourceEpoch,
      sourceSequence: batch.sourceSequence,
      dependencyKeys: [...keysBySource.values()],
    });
    return Object.freeze({
      admittedBatch,
      metrics: Object.freeze({
        modelSemanticWorkUnits: semanticWork,
        modelSemanticBytes: semanticBytes,
        dependencyKeyExaminations: examinations,
        canonicalDependencyBytes: canonicalBytes,
      }),
    });
  });
}

function projectAuthority(
  operationPrefix: "kv" | "graph",
  input: AuthorityObservationInput<
    KeyValueAuthorityObservation | GraphAuthorityObservation
  >,
  budget: AuthorityProjectionBudget,
): Result.Result<AuthorityObservationProjection, ChangeProjectionError> {
  return Result.gen(function* () {
    const observation: unknown = input.observation;
    if (!isNonArrayRecord(observation)) {
      return yield* Result.fail(invalidProjection(
        "projectAuthorityObservation",
        "invalidAuthorityObservation",
        input.observedThroughSequence,
      ));
    }
    const primary = operationPrefix === "kv"
      ? observation.revision
      : observation.head;
    const members = operationPrefix === "kv"
      ? observation.partitions
      : observation.vertices;
    if (!Array.isArray(members)) {
      return yield* Result.fail(invalidProjection(
        "projectAuthorityObservation",
        "invalidAuthorityObservation",
        input.observedThroughSequence,
      ));
    }
    let canonicalPrimary: number | string;
    if (operationPrefix === "kv") {
      if (
        !isNonNegativeSafeInteger(primary)
      ) {
        return yield* Result.fail(invalidProjection(
          "projectAuthorityObservation",
          "invalidAuthorityObservation",
          input.observedThroughSequence,
        ));
      }
      canonicalPrimary = primary;
    } else {
      if (typeof primary !== "string") {
        return yield* Result.fail(invalidProjection(
          "projectAuthorityObservation",
          "invalidAuthorityObservation",
          input.observedThroughSequence,
        ));
      }
      canonicalPrimary = primary;
    }
    let work = 1;
    const primaryMeasurement = typeof canonicalPrimary === "string"
      ? measureUtf8AtMost(canonicalPrimary, budget.modelSemanticBytes)
      : Object.freeze({
        byteLength: Math.min(8, budget.modelSemanticBytes + 1),
        exceeded: 8 > budget.modelSemanticBytes,
        containsNull: false,
      });
    if (primaryMeasurement === null) {
      return yield* Result.fail(invalidProjection(
        "projectAuthorityObservation",
        "invalidAuthorityObservation",
        input.observedThroughSequence,
      ));
    }
    let bytes = primaryMeasurement.byteLength;
    const canonicalMembers: string[] = [];
    if (work > budget.modelSemanticWorkUnits) {
      return yield* Result.fail(projectionLimit(
        "projectAuthorityObservation",
        "modelSemanticWorkUnits",
        budget.modelSemanticWorkUnits,
        work,
      ));
    }
    if (primaryMeasurement.exceeded) {
      return yield* Result.fail(projectionLimit(
        "projectAuthorityObservation",
        "modelSemanticBytes",
        budget.modelSemanticBytes,
        budget.modelSemanticBytes + 1,
      ));
    }
    for (
      let memberIndex = 0;
      memberIndex < members.length;
      memberIndex += 1
    ) {
      const member = members[memberIndex];
      work += 1;
      if (work > budget.modelSemanticWorkUnits) {
        return yield* Result.fail(projectionLimit(
          "projectAuthorityObservation",
          "modelSemanticWorkUnits",
          budget.modelSemanticWorkUnits,
          work,
        ));
      }
      if (typeof member !== "string") {
        return yield* Result.fail(invalidProjection(
          "projectAuthorityObservation",
          "invalidAuthorityObservation",
          input.observedThroughSequence,
        ));
      }
      const memberMeasurement = measureUtf8AtMost(
        member,
        budget.modelSemanticBytes - bytes,
      );
      if (memberMeasurement === null) {
        return yield* Result.fail(invalidProjection(
          "projectAuthorityObservation",
          "invalidAuthorityObservation",
          input.observedThroughSequence,
        ));
      }
      bytes += memberMeasurement.byteLength;
      if (memberMeasurement.exceeded) {
        return yield* Result.fail(projectionLimit(
          "projectAuthorityObservation",
          "modelSemanticBytes",
          budget.modelSemanticBytes,
          budget.modelSemanticBytes + 1,
        ));
      }
      canonicalMembers.push(member);
    }
    const authorityWitness = yield* exactAuthorityWitness(
      operationPrefix === "kv" ? 0x4b : 0x47,
      canonicalPrimary,
      canonicalMembers,
      input.observedThroughSequence,
    );
    return Object.freeze({
      authorityWitness,
      metrics: Object.freeze({
        modelSemanticWorkUnits: work,
        modelSemanticBytes: bytes,
      }),
    });
  });
}

export function makeKeyValueInvalidationProjector(
  syncModelId: SyncModelId,
): InvalidationProjector<
  KeyValueCommittedPayload,
  KeyValueAuthorityObservation
> {
  return Object.freeze({
    syncModelId,
    projectCommittedBatch: projectKeyValueBatch,
    projectAuthorityObservation: (
      input: AuthorityObservationInput<KeyValueAuthorityObservation>,
      budget: AuthorityProjectionBudget,
    ) => projectAuthority(
      "kv",
      input,
      budget,
    ),
  });
}

export function makeGraphInvalidationProjector(
  syncModelId: SyncModelId,
): InvalidationProjector<GraphCommittedPayload, GraphAuthorityObservation> {
  return Object.freeze({
    syncModelId,
    projectCommittedBatch: projectGraphBatch,
    projectAuthorityObservation: (
      input: AuthorityObservationInput<GraphAuthorityObservation>,
      budget: AuthorityProjectionBudget,
    ) => projectAuthority(
      "graph",
      input,
      budget,
    ),
  });
}
