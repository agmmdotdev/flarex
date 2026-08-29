import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import {
  ChangeProjectionLimitError,
  CommittedChangeInvalidError,
} from "@flarex/query-sync/internal/change";
import type {
  AuthorityObservationInput,
  AuthorityObservationProjection,
  AuthorityProjectionBudget,
  ChangeProjectionBudget,
  ChangeProjectionError,
  ChangeProjectionMetrics,
  CommittedBatchProjection,
  InvalidationProjector,
  SourceCommittedBatch,
} from "@flarex/query-sync/internal/change";
import {
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryPublicationArtifact,
  captureQuerySnapshot,
  captureSyncModelId,
  captureQueryAuthorityWitness,
  captureQueryResultDigest,
  captureSyncEpoch,
  captureSyncNamespaceId,
  captureSyncSequence,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
} from "@flarex/query-sync/internal/kernel";
import type {
  CanonicalDependencyKey,
  QueryDescriptor,
  QueryPublicationArtifact,
  QueryResultDigest,
  QuerySnapshot,
  QuerySyncCanonicalValueError,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import type { QueryEvaluationArtifact } from
  "@flarex/query-sync/internal/orchestration";
import { Data, Effect, Encoding, Layer, Result } from "effect";

import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
} from "flarex-protocol/app-document-id";
import {
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncDependencyKeyV1,
  compareScopeSyncDependencyKeysV1,
  type ScopeSyncDependencyKeyV1,
  type ScopeSyncQueryGenerationSequenceV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
  ScopeSyncQueryModelSha256,
  ScopeSyncQueryModelSha256Error,
  canonicalizeScopeSyncDependencyKeyV1Result,
  type ScopeSyncDependencyKeyEvidenceV1,
  type ScopeSyncQueryAuthorityEvidenceV1,
  type ScopeSyncQueryKeyEvidenceV1,
} from "flarex-protocol/internal/scope-sync-query-model-v1";
import {
  copyCanonicalFlarexValueBytesV1,
  copyFlarexValueSha256V1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import type {
  CommitSeq,
  ScopeEpochUuidV1,
  ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import { ScopeSyncInvalidCommitChangeError } from "./Model";

const APP_ROW_SEMANTIC_BYTES_V1 = 4 + 16;
const RELATION_ADJACENCY_SEMANTIC_BYTES_V1 = 4 + 1 + 16;

export type ScopeSyncQueryModelMappingOperationV1 =
  | "mapQueryDescriptor"
  | "mapDependencyKey"
  | "mapQueryResult"
  | "mapQueryEvaluation";

export type ScopeSyncQueryModelAuthorityFieldV1 =
  | "scopeUuid"
  | "syncModelId"
  | "epochUuid"
  | "activationSequence"
  | "activeHeadSha256Hex";

export class ScopeSyncQueryModelMappingV1Error extends Data.TaggedError(
  "ScopeSyncQueryModelMappingV1Error",
)<{
  readonly operation: ScopeSyncQueryModelMappingOperationV1;
  readonly reason:
    | "portableContractRejected"
    | "queryAuthorityMismatch"
    | "publicationContentTooLarge";
  readonly field: ScopeSyncQueryModelAuthorityFieldV1 | null;
  readonly maximumBytes: number | null;
  readonly observedBytes: number | null;
  readonly cause: unknown | null;
}> {}

export interface ScopeSyncQueryResultProjectionV1 {
  readonly resultDigest: QueryResultDigest;
  readonly publication: QueryPublicationArtifact;
}

export interface ScopeSyncQueryEvaluationProjectionV1Input {
  readonly query: ScopeSyncQueryKeyEvidenceV1;
  readonly generation: ScopeSyncQueryGenerationSequenceV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly authority: ScopeSyncQueryAuthorityEvidenceV1;
  readonly dependencies: ReadonlyArray<ScopeSyncDependencyKeyEvidenceV1>;
  readonly result: CanonicalFlarexValueV1;
}

export interface ScopeSyncCommitInvalidationProjectionV1 {
  readonly dependencies: ReadonlyArray<ScopeSyncDependencyKeyEvidenceV1>;
  readonly metrics: ChangeProjectionMetrics;
}

interface MutableProjectionMetrics {
  modelSemanticWorkUnits: number;
  modelSemanticBytes: number;
  dependencyKeyExaminations: number;
  canonicalDependencyBytes: number;
}

export const FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1: SyncModelId =
  Result.getOrThrow(captureSyncModelId(
    SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
  ));

const digestScopeSyncQueryModelSha256 = Effect.fn(
  "FlarexBackend.ScopeSyncQueryModelSha256.digest",
)(function* (
  canonicalBytes: Uint8Array,
): Effect.fn.Return<Uint8Array, ScopeSyncQueryModelSha256Error> {
  const owned = new Uint8Array(canonicalBytes);
  return yield* Effect.tryPromise({
    try: async () => new Uint8Array(
      await crypto.subtle.digest("SHA-256", owned),
    ),
    catch: cause => new ScopeSyncQueryModelSha256Error({
      operation: "digest",
      cause,
    }),
  });
});

export const ScopeSyncQueryModelWebCryptoSha256Live = Layer.succeed(
  ScopeSyncQueryModelSha256,
  ScopeSyncQueryModelSha256.of({
    digest: digestScopeSyncQueryModelSha256,
  }),
);

export function captureScopeSyncNamespaceIdV1(
  scopeUuid: ScopeUuidV1,
): Result.Result<SyncNamespaceId, QuerySyncCanonicalValueError> {
  return captureSyncNamespaceId(scopeUuid);
}

export function captureScopeSyncSourceEpochV1(
  epochUuid: ScopeEpochUuidV1,
): Result.Result<SyncEpoch, QuerySyncCanonicalValueError> {
  return captureSyncEpoch(epochUuid);
}

export function captureScopeSyncSourceSequenceV1(
  commitSeq: CommitSeq,
): Result.Result<SyncSequence, QuerySyncCanonicalValueError> {
  return captureSyncSequence(commitSeq);
}

export function captureScopeSyncQuerySnapshotV1(
  commitSeq: CommitSeq,
): Result.Result<QuerySnapshot, QuerySyncCanonicalValueError> {
  return captureQuerySnapshot(commitSeq);
}

function mappingFailure(
  operation: ScopeSyncQueryModelMappingOperationV1,
  cause: unknown,
): ScopeSyncQueryModelMappingV1Error {
  return new ScopeSyncQueryModelMappingV1Error({
    operation,
    reason: "portableContractRejected",
    field: null,
    maximumBytes: null,
    observedBytes: null,
    cause,
  });
}

function authorityMismatch(
  field: ScopeSyncQueryModelAuthorityFieldV1,
): ScopeSyncQueryModelMappingV1Error {
  return new ScopeSyncQueryModelMappingV1Error({
    operation: "mapQueryEvaluation",
    reason: "queryAuthorityMismatch",
    field,
    maximumBytes: null,
    observedBytes: null,
    cause: null,
  });
}

export function captureScopeSyncQueryDescriptorV1Result(
  evidence: ScopeSyncQueryKeyEvidenceV1,
): Result.Result<QueryDescriptor, ScopeSyncQueryModelMappingV1Error> {
  return captureQueryDescriptor({
    queryKey: Encoding.encodeBase64Url(evidence.sha256),
    queryIdentity: Encoding.encodeBase64Url(evidence.canonicalBytes),
  }).pipe(Result.mapError(cause => mappingFailure(
    "mapQueryDescriptor",
    cause,
  )));
}

export function captureScopeSyncCanonicalDependencyKeyV1Result(
  evidence: ScopeSyncDependencyKeyEvidenceV1,
): Result.Result<CanonicalDependencyKey, ScopeSyncQueryModelMappingV1Error> {
  return captureCanonicalDependencyKey(
    Encoding.encodeBase64Url(evidence.canonicalBytes),
  ).pipe(Result.mapError(cause => mappingFailure(
    "mapDependencyKey",
    cause,
  )));
}

export function captureScopeSyncQueryResultProjectionV1Result(
  canonical: CanonicalFlarexValueV1,
): Result.Result<
  ScopeSyncQueryResultProjectionV1,
  ScopeSyncQueryModelMappingV1Error
> {
  const canonicalBytes = copyCanonicalFlarexValueBytesV1(
    canonical.canonicalBytes,
  );
  const sha256 = copyFlarexValueSha256V1(canonical.sha256);
  const observedBytes = canonicalBytes.byteLength;
  if (observedBytes > MAX_INLINE_PUBLICATION_CONTENT_BYTES) {
    return Result.fail(new ScopeSyncQueryModelMappingV1Error({
      operation: "mapQueryResult",
      reason: "publicationContentTooLarge",
      field: null,
      maximumBytes: MAX_INLINE_PUBLICATION_CONTENT_BYTES,
      observedBytes,
      cause: null,
    }));
  }
  return Result.gen(function* () {
    const resultDigest = yield* captureQueryResultDigest(
      Encoding.encodeBase64Url(sha256),
    ).pipe(Result.mapError(cause => mappingFailure(
      "mapQueryResult",
      cause,
    )));
    const publication = yield* captureQueryPublicationArtifact({
      content: Encoding.encodeBase64Url(canonicalBytes),
    }).pipe(Result.mapError(cause => mappingFailure(
      "mapQueryResult",
      cause,
    )));
    return Object.freeze({ resultDigest, publication });
  });
}

function validateEvaluationAuthority(
  input: ScopeSyncQueryEvaluationProjectionV1Input,
): Result.Result<void, ScopeSyncQueryModelMappingV1Error> {
  const identity = input.query.frame.identity;
  const authority = input.authority.authority;
  if (authority.scopeUuid !== identity.scopeUuid) {
    return Result.fail(authorityMismatch("scopeUuid"));
  }
  if (authority.syncModelId !== SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1) {
    return Result.fail(authorityMismatch("syncModelId"));
  }
  if (authority.epochUuid !== identity.epochUuid) {
    return Result.fail(authorityMismatch("epochUuid"));
  }
  if (authority.activationSequence !== identity.activationSequence) {
    return Result.fail(authorityMismatch("activationSequence"));
  }
  if (authority.activeHeadSha256Hex !== identity.activeHeadSha256Hex) {
    return Result.fail(authorityMismatch("activeHeadSha256Hex"));
  }
  return Result.succeed(undefined);
}

export function captureScopeSyncQueryEvaluationProjectionV1Result(
  input: ScopeSyncQueryEvaluationProjectionV1Input,
): Result.Result<
  QueryEvaluationArtifact,
  ScopeSyncQueryModelMappingV1Error
> {
  return Result.gen(function* () {
    yield* validateEvaluationAuthority(input);
    const descriptor = yield* captureScopeSyncQueryDescriptorV1Result(
      input.query,
    );
    const result = yield* captureScopeSyncQueryResultProjectionV1Result(
      input.result,
    );
    const dependencyKeys: CanonicalDependencyKey[] = [];
    for (const dependency of input.dependencies) {
      dependencyKeys.push(yield*
        captureScopeSyncCanonicalDependencyKeyV1Result(dependency));
    }
    const evaluation = yield* captureQueryEvaluationEvidence({
      namespaceId: input.query.frame.identity.scopeUuid,
      syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      sourceEpoch: input.query.frame.identity.epochUuid,
      descriptor,
      generation: input.generation,
      snapshotSequence: input.snapshotCommitSeq,
      resultDigest: result.resultDigest,
      authorityWitness: Encoding.encodeBase64Url(input.authority.sha256),
      dependencyKeys,
    }).pipe(Result.mapError(cause => mappingFailure(
      "mapQueryEvaluation",
      cause,
    )));
    return Object.freeze({
      evaluation,
      publication: result.publication,
    });
  });
}

function projectionLimit(
  operation: ChangeProjectionLimitError["operation"],
  dimension: ChangeProjectionLimitError["dimension"],
  maximum: number,
): ChangeProjectionLimitError {
  return new ChangeProjectionLimitError({
    operation,
    dimension,
    maximum,
    observed: maximum + 1,
  });
}

function consumeProjectionBudget(
  metrics: MutableProjectionMetrics,
  dimension: keyof MutableProjectionMetrics,
  amount: number,
  budget: ChangeProjectionBudget | null,
): Result.Result<void, ChangeProjectionLimitError> {
  const next = metrics[dimension] + amount;
  if (budget !== null && next > budget[dimension]) {
    return Result.fail(projectionLimit(
      "projectCommittedBatch",
      dimension,
      budget[dimension],
    ));
  }
  metrics[dimension] = next;
  return Result.succeed(undefined);
}

function canonicalizeProjectedDependency(
  dependency: ScopeSyncDependencyKeyV1,
): ScopeSyncDependencyKeyEvidenceV1 {
  return Result.getOrThrow(
    canonicalizeScopeSyncDependencyKeyV1Result(dependency),
  );
}

function addProjectedDependency(
  dependency: ScopeSyncDependencyKeyV1,
  dependenciesByCanonicalText: Map<
    string,
    ScopeSyncDependencyKeyEvidenceV1
  >,
  metrics: MutableProjectionMetrics,
  budget: ChangeProjectionBudget | null,
): Result.Result<void, ChangeProjectionLimitError> {
  const evidence = canonicalizeProjectedDependency(dependency);
  if (dependenciesByCanonicalText.has(evidence.canonicalText)) {
    return Result.succeed(undefined);
  }
  return consumeProjectionBudget(
    metrics,
    "canonicalDependencyBytes",
    evidence.canonicalBytes.byteLength,
    budget,
  ).pipe(Result.map(() => {
    dependenciesByCanonicalText.set(evidence.canonicalText, evidence);
  }));
}

export function collectScopeSyncCommitInvalidationProjectionV1Result(
  commit: CommitFeedCommitV1,
): Result.Result<
  ScopeSyncCommitInvalidationProjectionV1,
  ScopeSyncInvalidCommitChangeError
>;
export function collectScopeSyncCommitInvalidationProjectionV1Result(
  commit: CommitFeedCommitV1,
  budget: ChangeProjectionBudget,
): Result.Result<
  ScopeSyncCommitInvalidationProjectionV1,
  ScopeSyncInvalidCommitChangeError | ChangeProjectionLimitError
>;
export function collectScopeSyncCommitInvalidationProjectionV1Result(
  commit: CommitFeedCommitV1,
  budget: ChangeProjectionBudget | null = null,
): Result.Result<
  ScopeSyncCommitInvalidationProjectionV1,
  ScopeSyncInvalidCommitChangeError | ChangeProjectionLimitError
> {
  return Result.gen(function* () {
    const metrics: MutableProjectionMetrics = {
      modelSemanticWorkUnits: 0,
      modelSemanticBytes: 0,
      dependencyKeyExaminations: 0,
      canonicalDependencyBytes: 0,
    };
    const dependenciesByCanonicalText = new Map<
      string,
      ScopeSyncDependencyKeyEvidenceV1
    >();

    yield* consumeProjectionBudget(
      metrics,
      "modelSemanticWorkUnits",
      1,
      budget,
    );
    for (const change of commit.appRowChanges) {
      yield* consumeProjectionBudget(
        metrics,
        "modelSemanticWorkUnits",
        1,
        budget,
      );
      yield* consumeProjectionBudget(
        metrics,
        "modelSemanticBytes",
        APP_ROW_SEMANTIC_BYTES_V1,
        budget,
      );
      yield* consumeProjectionBudget(
        metrics,
        "dependencyKeyExaminations",
        1,
        budget,
      );
      const rowId = yield* appRowIdHexV1FromBytesResult(change.rowId).pipe(
        Result.mapError(cause => new ScopeSyncInvalidCommitChangeError({
          operation: "collectInvalidationKeys",
          changeKind: "appRow",
          changeOrdinal: change.ordinal,
          cause,
        })),
      );
      yield* addProjectedDependency(
        captureScopeSyncDependencyKeyV1({
          format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
          version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
          kind: "appRowPoint",
          documentId: appDocumentIdV1FromRowIdentity({
            tableId: change.tableId,
            rowId,
          }),
        }),
        dependenciesByCanonicalText,
        metrics,
        budget,
      );

      yield* consumeProjectionBudget(
        metrics,
        "dependencyKeyExaminations",
        1,
        budget,
      );
      yield* addProjectedDependency(
        captureScopeSyncDependencyKeyV1({
          format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
          version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
          kind: "appTable",
          tableId: change.tableId,
        }),
        dependenciesByCanonicalText,
        metrics,
        budget,
      );
    }

    for (const change of commit.relationAdjacencyChanges) {
      yield* consumeProjectionBudget(
        metrics,
        "modelSemanticWorkUnits",
        1,
        budget,
      );
      yield* consumeProjectionBudget(
        metrics,
        "modelSemanticBytes",
        RELATION_ADJACENCY_SEMANTIC_BYTES_V1,
        budget,
      );
      if (change.direction === "outgoing") continue;
      yield* consumeProjectionBudget(
        metrics,
        "dependencyKeyExaminations",
        1,
        budget,
      );
      yield* addProjectedDependency(
        captureScopeSyncDependencyKeyV1({
          format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
          version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
          kind: "appRelationIncoming",
          edgeDefinitionId: change.edgeDefinitionId,
          targetRowId: change.endpointRowId,
        }),
        dependenciesByCanonicalText,
        metrics,
        budget,
      );
    }

    const dependencies = [...dependenciesByCanonicalText.values()]
      .toSorted((left, right) => compareScopeSyncDependencyKeysV1(
        left.dependencyKey,
        right.dependencyKey,
      ));
    return Object.freeze({
      dependencies: Object.freeze(dependencies),
      metrics: Object.freeze({ ...metrics }),
    });
  });
}

function projectionAuthorityMismatch(
  sourceSequence: SyncSequence,
  operation:
    | "projectCommittedBatch"
    | "projectAuthorityObservation",
  reason: CommittedChangeInvalidError["reason"],
): CommittedChangeInvalidError {
  return new CommittedChangeInvalidError({
    operation,
    reason,
    sourceSequence,
  });
}

function projectCommittedBatch(
  batch: SourceCommittedBatch<CommitFeedCommitV1>,
  budget: ChangeProjectionBudget,
): Result.Result<CommittedBatchProjection, ChangeProjectionError> {
  const commit = batch.payload;
  if (
    !sameStringValue(batch.namespaceId, commit.scopeUuid)
    || batch.syncModelId !== FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1
    || !sameStringValue(batch.sourceEpoch, commit.epochUuid)
    || !sameBigIntValue(batch.sourceSequence, commit.commitSeq)
  ) {
    return Result.fail(projectionAuthorityMismatch(
      batch.sourceSequence,
      "projectCommittedBatch",
      "projectionAuthorityMismatch",
    ));
  }
  return Result.gen(function* () {
    const projected = yield*
      collectScopeSyncCommitInvalidationProjectionV1Result(
        commit,
        budget,
      ).pipe(Result.mapError((cause) =>
        cause._tag === "ScopeSyncInvalidCommitChangeError"
          ? projectionAuthorityMismatch(
            batch.sourceSequence,
            "projectCommittedBatch",
            "invalidPayload",
          )
          : cause
      ));
    const admittedBatch = yield* captureAdmittedInvalidationBatch({
      namespaceId: batch.namespaceId,
      syncModelId: batch.syncModelId,
      sourceEpoch: batch.sourceEpoch,
      sourceSequence: batch.sourceSequence,
      dependencyKeys: projected.dependencies.map(dependency =>
        Encoding.encodeBase64Url(dependency.canonicalBytes)
      ),
    });
    return Object.freeze({
      admittedBatch,
      metrics: projected.metrics,
    });
  });
}

function projectAuthorityObservation(
  input: AuthorityObservationInput<ScopeSyncQueryAuthorityEvidenceV1>,
  budget: AuthorityProjectionBudget,
): Result.Result<AuthorityObservationProjection, CommittedChangeInvalidError |
  ChangeProjectionLimitError> {
  const authority = input.observation.authority;
  if (
    !sameStringValue(input.namespaceId, authority.scopeUuid)
    || input.syncModelId !== FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1
    || authority.syncModelId !== SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1
    || !sameStringValue(input.sourceEpoch, authority.epochUuid)
  ) {
    return Result.fail(projectionAuthorityMismatch(
      input.observedThroughSequence,
      "projectAuthorityObservation",
      "projectionAuthorityMismatch",
    ));
  }
  if (budget.modelSemanticWorkUnits < 1) {
    return Result.fail(projectionLimit(
      "projectAuthorityObservation",
      "modelSemanticWorkUnits",
      budget.modelSemanticWorkUnits,
    ));
  }
  const semanticBytes = input.observation.canonicalBytes.byteLength;
  if (budget.modelSemanticBytes < semanticBytes) {
    return Result.fail(projectionLimit(
      "projectAuthorityObservation",
      "modelSemanticBytes",
      budget.modelSemanticBytes,
    ));
  }
  const authorityWitness = Result.getOrThrow(captureQueryAuthorityWitness(
    Encoding.encodeBase64Url(input.observation.sha256),
  ));
  return Result.succeed(Object.freeze({
      authorityWitness,
      metrics: Object.freeze({
        modelSemanticWorkUnits: 1,
        modelSemanticBytes: semanticBytes,
      }),
    }));
}

function sameStringValue(left: string, right: string): boolean {
  return left === right;
}

function sameBigIntValue(left: bigint, right: bigint): boolean {
  return left === right;
}

export const flarexApplicationQueryInvalidationProjectorV1: InvalidationProjector<
  CommitFeedCommitV1,
  ScopeSyncQueryAuthorityEvidenceV1
> = Object.freeze({
  syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
  projectCommittedBatch,
  projectAuthorityObservation,
});
